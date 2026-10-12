/**
 * Which nova-capture the daemon launches.
 *
 * The app bundle carries its own capture (Contents/MacOS/nova-capture) and the
 * shell names it in NOVA_CAPTURE_BIN, so capture runs under Nova.app's
 * signature and Accessibility grant. A daemon started by hand has no such
 * variable and uses the checkout's debug build, exactly as before the bundle.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export const CHECKOUT_CAPTURE_BIN =
  join(import.meta.dir, "..", "..", "capture", ".build", "debug", "nova-capture");

export interface CaptureBin {
  path: string;
  source: "env" | "checkout";
  /** Set when NOVA_CAPTURE_BIN was ignored; the caller logs it. */
  note: string | null;
}

export function resolveCaptureBin(
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
  fallback: string = CHECKOUT_CAPTURE_BIN,
): CaptureBin {
  const wanted = env.NOVA_CAPTURE_BIN?.trim();
  if (!wanted) return { path: fallback, source: "checkout", note: null };
  if (exists(wanted)) return { path: wanted, source: "env", note: null };
  return {
    path: fallback,
    source: "checkout",
    note: `NOVA_CAPTURE_BIN=${wanted} does not exist; using the checkout build`,
  };
}
