// Runs the live prompts over eval/fixtures.local.json and saves every raw
// answer, so scoring (eval/score.ts) can be repeated without paying again.
//
//   bun eval/run.ts <run-name> [--reps 3] [--fixtures fixtures-attributed.local.json]
//
// Uses the provider configured in .env, exactly as the daemon does, with the
// user identity from NOVA_USER_NAME / NOVA_USER_ALIASES.
import { providerFromEnv, userIdentityFromEnv } from "../src/provider";
import { watchesForLoops } from "../src/loops";
import type { Fixture, Label } from "./types";
import { join } from "node:path";

const name = process.argv[2];
if (!name || name.startsWith("--")) {
  console.error("usage: bun eval/run.ts <run-name> [--reps N]");
  process.exit(1);
}
const repsArg = process.argv.indexOf("--reps");
const reps = repsArg > 0 ? Number(process.argv[repsArg + 1]) : 3;

const dir = import.meta.dir;
const fixArg = process.argv.indexOf("--fixtures");
const fixtureFile = fixArg > 0 ? process.argv[fixArg + 1]! : "fixtures.local.json";
const fixtures: Fixture[] = await Bun.file(join(dir, fixtureFile)).json();
const closuresFile = Bun.file(join(dir, "closures.local.json"));
const closures: ClosureCase[] = (await closuresFile.exists()) ? await closuresFile.json() : [];
const provider = providerFromEnv();
const user = userIdentityFromEnv();

interface ClosureCase {
  loop: { description: string; direction: string; counterparty: string | null };
  openIn: string[];
  closedIn: string[];
}

export interface RunOutput {
  name: string;
  reps: number;
  fixtures: string;
  extraction: {
    id: string;
    rep: number;
    memories: string[];
    loops: unknown[];
    closed: unknown[];
    ms: number;
  }[];
  closure: { case: number; fixture: string; expectClosed: boolean; closed: boolean }[];
}

/** Older providers return a bare array; the current one returns {loops, closed}. */
function normalize(r: unknown): { loops: unknown[]; closed: unknown[] } {
  if (Array.isArray(r)) return { loops: r, closed: [] };
  const o = (r ?? {}) as { loops?: unknown[]; closed?: unknown[] };
  return { loops: o.loops ?? [], closed: o.closed ?? [] };
}

async function pool<T>(items: T[], width: number, fn: (t: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < items.length) await fn(items[next++]!);
  }));
}

const out: RunOutput = { name, reps, fixtures: fixtureFile, extraction: [], closure: [] };
const jobs = fixtures.flatMap((f) => Array.from({ length: reps }, (_, rep) => ({ f, rep })));

await pool(jobs, 4, async ({ f, rep }) => {
  const ctx = { ...f.ctx, user };
  const t0 = performance.now();
  const [memories, loops] = await Promise.all([
    provider.extract(f.text, ctx),
    // Mirror the pipeline, which never asks about sources it does not watch.
    provider.extractLoops && watchesForLoops(f.ctx.app, f.ctx.url ?? null)
      ? provider.extractLoops(f.text, ctx)
      : Promise.resolve([]),
  ]);
  out.extraction.push({ id: f.id, rep, memories, ...normalize(loops), ms: Math.round(performance.now() - t0) });
  console.error(`extract ${f.id} rep ${rep}`);
});

// Closure: hand the provider one tracked loop and a capture, and record
// whether it says the capture closes it. A provider without closure support
// never closes anything, which scores as every closure missed.
const byId = new Map(fixtures.map((f) => [f.id, f]));
const closureJobs = closures.flatMap((c, i) => [
  ...c.openIn.map((fid) => ({ i, fid, expectClosed: false })),
  ...c.closedIn.map((fid) => ({ i, fid, expectClosed: true })),
]);
await pool(closureJobs, 4, async ({ i, fid, expectClosed }) => {
  const f = byId.get(fid);
  if (!f || !provider.extractLoops) return;
  const c = closures[i]!;
  const tracked = [{
    id: "L1", description: c.loop.description,
    direction: c.loop.direction, counterparty: c.loop.counterparty,
  }];
  const r = normalize(await (provider.extractLoops as any)(f.text, { ...f.ctx, user }, tracked));
  const closed = r.closed.some((x: any) => x?.id === "L1");
  out.closure.push({ case: i, fixture: fid, expectClosed, closed });
  console.error(`closure case ${i} on ${fid}: ${closed ? "closed" : "open"}`);
});

const path = join(dir, "runs", `${name}.local.json`);
await Bun.write(path, JSON.stringify(out, null, 2));
console.error(`wrote ${path}`);
