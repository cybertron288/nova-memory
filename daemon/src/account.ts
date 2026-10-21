/**
 * Which Nova Cloud account this store belongs to (nova-cloud-design.md,
 * "A different account clears this Mac's memory").
 *
 * The user id is kept only as a keyed digest and the email only encrypted:
 * both identify a person, like everything else the field key covers. The
 * email is kept at all so the switch warning can name the previous account.
 */
import type { Database } from "bun:sqlite";
import { decryptField, encryptField, lookupDigest } from "./db";
import { countForDelete } from "./forget";

export type Binding =
  | { kind: "unbound" }
  | { kind: "same" }
  | { kind: "other"; previousEmail: string };

const ACCOUNT = "account";
const ACCOUNT_EMAIL = "account_email";

function meta(db: Database, name: string): string | null {
  return (db.prepare("SELECT value FROM store_metadata WHERE key=?").get(name) as { value: string } | null)?.value ?? null;
}

export function checkBinding(db: Database, key: Buffer, userId: string): Binding {
  const bound = meta(db, ACCOUNT);
  if (bound === null) return { kind: "unbound" };
  if (bound === lookupDigest(userId, key)) return { kind: "same" };
  const email = meta(db, ACCOUNT_EMAIL);
  return { kind: "other", previousEmail: maskEmail(email === null ? null : decryptField(email, key)) };
}

export function bindAccount(db: Database, key: Buffer, userId: string, email: string | null): void {
  const put = db.prepare(
    "INSERT INTO store_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  );
  db.transaction(() => {
    put.run(ACCOUNT, lookupDigest(userId, key));
    if (email === null) db.prepare("DELETE FROM store_metadata WHERE key=?").run(ACCOUNT_EMAIL);
    else put.run(ACCOUNT_EMAIL, encryptField(email, key));
  })();
}

/**
 * First letter and domain only: the person signing in may not be the person
 * whose memory this is.
 */
export function maskEmail(email: string | null): string {
  const at = email?.indexOf("@") ?? -1;
  if (!email || at < 1) return "another account";
  return `${email[0]}•••${email.slice(at)}`;
}

/** What signing in as someone else would delete, for the warning. */
export function mismatchSummary(db: Database): { memories: number; loops: number; since: number | null } {
  const counts = countForDelete(db, { kind: "all" });
  const since = (db.prepare("SELECT MIN(committed_at) t FROM memory_versions").get() as { t: number | null }).t;
  return { memories: counts.memories, loops: counts.loops, since };
}

/**
 * What the previous person set, beyond their captures: their name and handles
 * (a wrong identity inverts every loop), their blocked apps and sites, and
 * their retention choices. Run with the capture delete when another account
 * takes the store over.
 */
export function forgetPerson(db: Database): void {
  db.transaction(() => db.exec(`
    DELETE FROM store_metadata WHERE key IN
      ('user_identity', 'retention_raw_days', 'retention_memory_days', 'retention_last_sweep');
    DELETE FROM user_exclusions;
    DELETE FROM skip_counts;`))();
}
