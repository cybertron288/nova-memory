import { test, expect } from "bun:test";
import { resolveCaptureBin } from "../src/capture-bin";

const FALLBACK = "/checkout/capture/.build/debug/nova-capture";
const BUNDLED = "/checkout/build/Nova.app/Contents/MacOS/nova-capture";
const onDisk = (...paths: string[]) => (p: string) => paths.includes(p);

test("the bundled capture is used when NOVA_CAPTURE_BIN names one that exists", () => {
  const r = resolveCaptureBin({ NOVA_CAPTURE_BIN: BUNDLED }, onDisk(BUNDLED, FALLBACK), FALLBACK);
  expect(r).toEqual({ path: BUNDLED, source: "env", note: null });
});

test("a missing NOVA_CAPTURE_BIN falls back to the checkout, and says so", () => {
  // Silently running the checkout's build would run a stale capture while the
  // app claims to be running its own.
  const r = resolveCaptureBin({ NOVA_CAPTURE_BIN: BUNDLED }, onDisk(FALLBACK), FALLBACK);
  expect(r.path).toBe(FALLBACK);
  expect(r.source).toBe("checkout");
  expect(r.note).toContain(BUNDLED);
});

test("unset NOVA_CAPTURE_BIN uses the checkout build, as a hand-started daemon always has", () => {
  expect(resolveCaptureBin({}, onDisk(FALLBACK), FALLBACK))
    .toEqual({ path: FALLBACK, source: "checkout", note: null });
});

test("an empty or blank NOVA_CAPTURE_BIN counts as unset, not as a path", () => {
  for (const value of ["", "   "]) {
    expect(resolveCaptureBin({ NOVA_CAPTURE_BIN: value }, onDisk(FALLBACK), FALLBACK))
      .toEqual({ path: FALLBACK, source: "checkout", note: null });
  }
});
