/**
 * The user's identity as loop extraction and the digest read it (D24).
 *
 * Set in the app's Profile pane and kept in `store_metadata`, field-encrypted:
 * a name and the user's emails are personal data, like everything else the
 * field key covers. `NOVA_USER_NAME` / `NOVA_USER_ALIASES` stay as the
 * self-host fallback when nothing is stored.
 *
 * Read on every use rather than cached, so an edit applies to the next drain
 * without a restart.
 */
import type { Database } from "bun:sqlite";
import { decryptField, encryptField } from "./db";
import { userIdentityFromEnv, type UserIdentity } from "./provider";

const KEY_NAME = "user_identity";

export type IdentitySource = "app" | "env" | "none";

export function storedIdentity(db: Database, key: Buffer): UserIdentity | undefined {
  const row = db.prepare("SELECT value FROM store_metadata WHERE key=?").get(KEY_NAME) as
    { value: string } | null;
  if (!row) return undefined;
  return JSON.parse(decryptField(row.value, key)) as UserIdentity;
}

export function storeIdentity(db: Database, key: Buffer, identity: UserIdentity): void {
  db.prepare(
    "INSERT INTO store_metadata (key, value) VALUES (?, ?) "
    + "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(KEY_NAME, encryptField(JSON.stringify(identity), key));
}

/** The stored identity wins; else the env vars; else none. */
export function userIdentity(
  db: Database, key: Buffer, env: NodeJS.ProcessEnv = process.env,
): { identity: UserIdentity | undefined; source: IdentitySource } {
  const stored = storedIdentity(db, key);
  if (stored) return { identity: stored, source: "app" };
  const fromEnv = userIdentityFromEnv(env);
  if (fromEnv) return { identity: fromEnv, source: "env" };
  return { identity: undefined, source: "none" };
}

const NAME_MAX = 100;
const ALIASES_MAX = 20;
const ALIAS_MAX = 200;

/**
 * A `set_profile` request's identity, normalized, or the reason it is refused.
 * Refused rather than coerced: a wrong identity inverts loops silently.
 */
export function parseIdentity(name: unknown, aliases: unknown): UserIdentity | string {
  if (typeof name !== "string") return "name must be a string";
  const n = name.trim();
  if (!n) return "name must not be empty";
  if (n.length > NAME_MAX) return `name must be at most ${NAME_MAX} characters`;
  if (!Array.isArray(aliases) || !aliases.every((a) => typeof a === "string")) {
    return "aliases must be an array of strings";
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of aliases as string[]) {
    const a = raw.trim();
    if (!a) continue;
    if (a.length > ALIAS_MAX) return `each alias must be at most ${ALIAS_MAX} characters`;
    const folded = a.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    out.push(a);
  }
  if (out.length > ALIASES_MAX) return `at most ${ALIASES_MAX} aliases`;
  return { name: n, aliases: out };
}
