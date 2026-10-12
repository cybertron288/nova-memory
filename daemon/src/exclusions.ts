// The user's own exclusion list (D21, architecture §4: "a user deny-list").
//
// This layer is additive. The refusals in sensitive.ts are non-overridable by
// design, and nothing here subtracts from them: a user cannot opt back into
// capturing their bank. All this list does is refuse more.
//
// A domain match covers subdomains, because a person excluding
// "therapy.example" means the site, not one host of it. It is a suffix match
// on label boundaries rather than `includes`, so "nottherapy.example" and
// "therapy.example.co" are different sites and stay readable — the same
// reason normalizeUrl drops the query string rather than matching loosely.
import type { Database } from "bun:sqlite";
import { decryptField, encryptField, lookupDigest } from "./db";
import type { HardRuleId } from "./sensitive";
import { randomUUID } from "node:crypto";

export type ExclusionKind = "app" | "domain";

export interface Exclusion {
  id: string;
  kind: ExclusionKind;
  /** What is matched: a bundle id, a host, or an app name for an older rule. */
  value: string;
  /** What to show when `value` is an id nobody reads. Null when it is already
   *  readable — a host, or an app matched by name. */
  label: string | null;
  createdAt: number;
  /** Windows this rule has refused, ever. */
  skipped: number;
}

/**
 * One non-overridable category, for the Blocked apps pane.
 *
 * The pane has to show these beside the user's own list: a pane that showed
 * only what the user added would imply their list is everything standing
 * between Nova and their bank.
 */
export interface HardExclusion {
  id: HardRuleId;
  title: string;
  detail: string;
  /** Always false. Present so the pane renders it as locked rather than
   *  deciding that from the absence of a remove button. */
  overridable: false;
}

export function hardExclusions(): HardExclusion[] {
  return [
    {
      id: "password-managers",
      title: "Password managers and vaults",
      detail: "1Password, Bitwarden, Keychain Access, and browser password pages. "
        + "Their lists render as ordinary text, so the secure-field exclusion never sees them.",
      overridable: false,
    },
    {
      id: "banking",
      title: "Banking and payments",
      detail: "Matched on the site's host, never on words in a title, so a conversation "
        + "about a bank stays readable.",
      overridable: false,
    },
    {
      id: "private-browsing",
      title: "Private browsing",
      detail: "Incognito, Safari Private Browsing, and the equivalent in other browsers. "
        + "Opening a private window is a decision Nova honours.",
      overridable: false,
    },
    {
      id: "screen-sharing",
      title: "Screen sharing and meetings",
      detail: "Zoom, Teams, Meet and remote-desktop tools. What is on screen is being "
        + "shown to other people, and may be anything.",
      overridable: false,
    },
  ];
}

/**
 * Records that `ruleId` refused a window.
 *
 * Swallows its own failures: a count is an observation of a refusal that has
 * already happened, and losing one matters far less than turning a correct
 * refusal into an ingest error.
 */
export function countSkip(db: Database, ruleId: string, now = Date.now()): void {
  try {
    db.prepare(
      `INSERT INTO skip_counts (rule_id, skipped, last_at) VALUES (?, 1, ?)
         ON CONFLICT(rule_id) DO UPDATE SET skipped = skipped + 1, last_at = excluded.last_at`,
    ).run(ruleId, now);
  } catch (e) {
    console.error(`[exclusions] could not count a skip for ${ruleId}: ${e}`);
  }
}

/** Every rule's skip count, keyed by hard-rule id or user-exclusion id. */
export function skipCounts(db: Database): Record<string, number> {
  const rows = db.prepare("SELECT rule_id, skipped FROM skip_counts").all() as
    { rule_id: string; skipped: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.rule_id] = r.skipped;
  return out;
}

export interface NewExclusion {
  kind: ExclusionKind;
  value: string;
  /** For an app chosen from the picker: its display name, since `value` is
   *  then the bundle id. */
  label?: string;
}

/** A bundle id, as the app picker reports it: reverse-DNS, never a name. */
function looksLikeBundleId(v: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*){1,}$/.test(v) && v.includes(".");
}

/**
 * Normalizes what the user typed. A domain is accepted as a pasted URL, with
 * or without a scheme, `www.` or an `@` prefix, because that is how a person
 * supplies one; an app is only trimmed, since an app name is what it is.
 */
export function normalizeExclusion(kind: ExclusionKind, raw: string): string {
  const v = raw.trim();
  if (!v) throw new Error("an exclusion needs a value");
  // An app is stored as its bundle id when one was supplied, so the rule
  // survives a rename; otherwise as the name, which is all `nova exclude
  // --app` has. Bundle ids are case-insensitive in practice, names are not.
  if (kind === "app") return looksLikeBundleId(v) ? v.toLowerCase() : v;

  let host = v.replace(/^@/, "");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) {
    try {
      host = new URL(host).hostname;
    } catch {
      // Not a URL after all; fall through and treat it as a bare host.
    }
  }
  host = host.split("/")[0]!.split("?")[0]!.split("#")[0]!;
  host = host.replace(/^www\./i, "").replace(/\.$/, "").toLowerCase();
  if (!host) throw new Error("an exclusion needs a value");
  return host;
}

/** Adds one exclusion and returns its id. Adding it twice is a no-op. */
export function addExclusion(db: Database, key: Buffer, e: NewExclusion): string {
  const value = normalizeExclusion(e.kind, e.value);
  const digest = lookupDigest(`${e.kind}:${value.toLowerCase()}`, key);
  const existing = db
    .prepare("SELECT id FROM user_exclusions WHERE kind=? AND value_key=?")
    .get(e.kind, digest) as { id: string } | null;
  if (existing) return existing.id;

  const id = randomUUID();
  const label = e.label?.trim() ? encryptField(e.label.trim(), key) : null;
  db.prepare(
    "INSERT INTO user_exclusions (id, kind, value, value_key, label, created_at) VALUES (?,?,?,?,?,?)",
  ).run(id, e.kind, encryptField(value, key), digest, label, Date.now());
  return id;
}

/** Removes one exclusion. False when there was nothing to remove. */
export function removeExclusion(db: Database, id: string): boolean {
  return db.prepare("DELETE FROM user_exclusions WHERE id=?").run(id).changes > 0;
}

export function listExclusions(db: Database, key: Buffer): Exclusion[] {
  const rows = db
    .prepare(
      `SELECT e.id, e.kind, e.value, e.label, e.created_at,
              COALESCE(s.skipped, 0) AS skipped
         FROM user_exclusions e
         LEFT JOIN skip_counts s ON s.rule_id = e.id
        ORDER BY e.created_at`,
    )
    .all() as {
      id: string; kind: ExclusionKind; value: string; label: string | null;
      created_at: number; skipped: number;
    }[];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    value: decryptField(r.value, key),
    label: r.label ? decryptField(r.label, key) : null,
    createdAt: r.created_at,
    skipped: r.skipped,
  }));
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Why this capture is excluded by the user's own list, or null when it is not.
 *
 * Reads the list on every call rather than caching it: an exclusion the user
 * has just added has to take effect on the next capture, and a cache that
 * needed invalidating is how it would quietly not.
 */
export function userExcludedRule(
  db: Database, key: Buffer, app: string, url: string | null | undefined, _title: string,
  bundleId?: string | null,
): { id: string; reason: string } | null {
  const list = listExclusions(db, key);
  if (list.length === 0) return null;

  const appLower = app.toLowerCase();
  const bundleLower = bundleId?.toLowerCase() ?? null;
  const host = url ? hostOf(url) : null;
  for (const e of list) {
    if (e.kind === "app") {
      // A rule stored as a bundle id matches the capture's bundle id, so it
      // holds after the app is renamed. A rule stored as a name — everything
      // added by `nova exclude --app`, and every row from before ids were
      // stored — matches the name, which is all it has.
      const v = e.value.toLowerCase();
      const hit = looksLikeBundleId(e.value)
        ? bundleLower !== null && v === bundleLower
        : v === appLower;
      if (hit) return { id: e.id, reason: `excluded app ${e.label ?? e.value}` };
    }
    if (e.kind === "domain" && host) {
      const d = e.value.toLowerCase();
      if (host === d || host.endsWith(`.${d}`))
        return { id: e.id, reason: `excluded site ${e.value}` };
    }
  }
  return null;
}

/** The reason alone, for callers that only log or branch on it. */
export function userExcluded(
  db: Database, key: Buffer, app: string, url: string | null | undefined, title: string,
  bundleId?: string | null,
): string | null {
  return userExcludedRule(db, key, app, url, title, bundleId)?.reason ?? null;
}
