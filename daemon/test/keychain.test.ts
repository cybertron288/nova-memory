import { test, expect } from "bun:test";
import { getOrCreateKey, deleteKey, isGenuinelyAbsent } from "../src/keychain";

const ACCOUNT = "nova-test-key-DELETEME";

test("generates a 32-byte key and returns the same one on re-read", async () => {
  await deleteKey(ACCOUNT);            // start clean
  const first = await getOrCreateKey(ACCOUNT);
  expect(first.length).toBe(32);
  const second = await getOrCreateKey(ACCOUNT);
  expect(second.equals(first)).toBe(true);
  await deleteKey(ACCOUNT);
});

test("different accounts get different keys", async () => {
  await deleteKey(ACCOUNT); await deleteKey(ACCOUNT + "-2");
  const a = await getOrCreateKey(ACCOUNT);
  const b = await getOrCreateKey(ACCOUNT + "-2");
  expect(a.equals(b)).toBe(false);
  await deleteKey(ACCOUNT); await deleteKey(ACCOUNT + "-2");
});

// Finding 1 regression coverage: exit 44 ("item not found") is the ONLY
// code that means "genuine first use, safe to mint a key". Any other
// non-zero exit (locked keychain, access denied, usage error, ...) must
// not be treated the same way, or a locked Keychain would silently orphan
// an existing encrypted database behind a freshly minted key.

test("isGenuinelyAbsent: true only for exit 44 (security's 'item not found')", () => {
  expect(isGenuinelyAbsent(44)).toBe(true);
  expect(isGenuinelyAbsent(0)).toBe(false);   // success — not "absent"
  expect(isGenuinelyAbsent(1)).toBe(false);   // generic failure
  expect(isGenuinelyAbsent(2)).toBe(false);   // security usage/argument error
  expect(isGenuinelyAbsent(51)).toBe(false);  // e.g. access denied
});

test("security CLI: item-not-found is exit 44, a usage error is a different code", async () => {
  // Confirms the real-world exit codes the module's classification relies on
  // haven't drifted from what Finding 1's fix assumes.
  const notFound = Bun.spawn(
    ["security", "find-generic-password", "-s", process.env.NOVA_KEYCHAIN_SERVICE!, "-a", ACCOUNT + "-does-not-exist", "-w"],
    { stdout: "pipe", stderr: "pipe" },
  );
  await new Response(notFound.stdout).text();
  await new Response(notFound.stderr).text();
  const notFoundCode = await notFound.exited;
  expect(notFoundCode).toBe(44);

  const usageError = Bun.spawn(
    ["security", "find-generic-password", "-a", ACCOUNT, "-w", "--bogus-flag-xyz"],
    { stdout: "pipe", stderr: "pipe" },
  );
  await new Response(usageError.stdout).text();
  await new Response(usageError.stderr).text();
  const usageErrorCode = await usageError.exited;
  expect(usageErrorCode).not.toBe(44);
  expect(isGenuinelyAbsent(usageErrorCode)).toBe(false);
});
