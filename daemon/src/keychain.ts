// Per-install key material in the macOS Keychain (R8 #1/#2). Never a constant
// in source, never derived from machine facts that change: a key derived from the home
// directory path breaks for good when the user renames their account.
import { randomBytes } from "node:crypto";

// Tests set NOVA_KEYCHAIN_SERVICE (test/setup.ts), so a test run never reads or
// mints keys under the service a real store is encrypted with.
const SERVICE = process.env.NOVA_KEYCHAIN_SERVICE || "dev.nova.keys";

/** `security` exit code meaning "no such keychain item" (genuine first use). */
const ITEM_NOT_FOUND = 44;

async function run(args: string[]): Promise<{ ok: boolean; code: number; out: string; err: string }> {
  const p = Bun.spawn(["security", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  const code = await p.exited;
  return { ok: code === 0, code, out: out.trim(), err: err.trim() };
}

/**
 * Whether a non-zero `find-generic-password` exit means "item genuinely
 * absent" (safe to mint a new key) vs. some other failure — a locked or
 * access-denied Keychain, for example — which must NOT be treated as
 * first-use, since that would silently orphan an existing encrypted
 * database. Exported for direct testing of the discrimination logic.
 */
export function isGenuinelyAbsent(code: number): boolean {
  return code === ITEM_NOT_FOUND;
}

export async function deleteKey(account: string): Promise<void> {
  await run(["delete-generic-password", "-s", SERVICE, "-a", account]);
}

/** The 32-byte key for `account`, generated and stored on first use. */
export async function getOrCreateKey(account: string): Promise<Buffer> {
  const found = await run(["find-generic-password", "-s", SERVICE, "-a", account, "-w"]);
  if (found.ok && found.out.length > 0) return Buffer.from(found.out, "base64");

  if (!found.ok && !isGenuinelyAbsent(found.code)) {
    // Any failure other than "item does not exist" (e.g. Keychain locked or
    // access denied) must not fall through to minting a new key — that would
    // silently orphan whatever database was encrypted with the existing one.
    throw new Error(`keychain: cannot read key for ${account}: ${found.err}`);
  }

  const key = randomBytes(32);
  const added = await run([
    "add-generic-password", "-s", SERVICE, "-a", account,
    "-w", key.toString("base64"), "-U",
  ]);
  if (!added.ok) {
    // Failing loudly matters: silently falling back to an ephemeral key would
    // produce a database that cannot be reopened after a restart.
    throw new Error(`keychain: could not store key for ${account}: ${added.err}`);
  }
  return key;
}

/**
 * A string item, or null only when the item genuinely does not exist.
 * Stored base64-encoded, so any value survives `security -i`'s tokenizer.
 */
export async function readSecret(account: string): Promise<string | null> {
  const found = await run(["find-generic-password", "-s", SERVICE, "-a", account, "-w"]);
  if (found.ok) return Buffer.from(found.out, "base64").toString("utf8");
  if (isGenuinelyAbsent(found.code)) return null;
  throw new Error(`keychain: cannot read ${account}: ${found.err}`);
}

/**
 * Written through `security -i` on stdin, never as an argument: a session is
 * rewritten every hour and holds the whole account, and arguments show in any
 * process listing on the Mac.
 */
export async function writeSecret(account: string, value: string): Promise<void> {
  const encoded = Buffer.from(value, "utf8").toString("base64");
  const p = Bun.spawn(["security", "-i"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  p.stdin.write(`add-generic-password -U -s ${SERVICE} -a ${account} -w ${encoded}\n`);
  await p.stdin.end();
  const [, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited;
  // `security -i` exits 0 even when a command inside it fails, so read back.
  const stored = await run(["find-generic-password", "-s", SERVICE, "-a", account, "-w"]);
  if (!stored.ok || stored.out !== encoded) {
    throw new Error(`keychain: could not store ${account}: ${err.trim() || stored.err}`);
  }
}

/**
 * This Mac's Nova Cloud device key. Random, so it says nothing about the
 * machine; Nova Cloud stores only its hash.
 */
export async function deviceKey(): Promise<string> {
  return (await getOrCreateKey("device")).toString("hex");
}
