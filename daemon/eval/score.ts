// Scores saved runs against eval/labels.local.json and eval/closures.local.json.
//
//   bun eval/score.ts <run-name>...
import type { Fixture, Label } from "./types";
import type { RunOutput } from "./run";
import { join } from "node:path";

const dir = import.meta.dir;
const allFixtures = async (file: string): Promise<Fixture[]> => Bun.file(join(dir, file)).json();
const labels: Label[] = await Bun.file(join(dir, "labels.local.json")).json();
const labelOf = new Map(labels.map((l) => [l.id, l]));

const NOISE = /\b(the user (viewed|was viewing|looked)|the (page|panel|editor|tab|window|screen) (showed|displayed|shows|displays))\b/i;
const MONTHS = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b/gi;

const side = (d: string) => (d === "i_owe" || d === "unanswered" ? "user acts" : d);

function score(run: RunOutput, textOf: Map<string, string>) {
  let tp = 0, fp = 0, fn = 0, wrongDirection = 0;
  const falseLoops: string[] = [];
  const missed: string[] = [];
  for (const e of run.extraction) {
    const label = labelOf.get(e.id);
    if (!label || label.ambiguous) continue;
    const open = [...label.loops];
    for (const raw of e.loops as { description: string; direction: string }[]) {
      const d = raw.description.toLowerCase();
      const hit = (x: Label["loops"][number]) => x.match.some((m) => d.includes(m.toLowerCase()));
      // i_owe and unanswered both mean the user has to act; which one a
      // request-to-the-user is filed under is a labelling call, not an error.
      const i = open.findIndex((x) => side(x.direction) === side(raw.direction) && hit(x));
      if (i >= 0) { tp++; open.splice(i, 1); continue; }
      fp++;
      if (label.loops.some(hit)) wrongDirection++;
      falseLoops.push(`${e.id}#${e.rep} [${raw.direction}] ${raw.description}`);
    }
    fn += open.length;
    for (const m of open) missed.push(`${e.id}#${e.rep} [${m.direction}] ${m.match.join("/")}`);
  }

  // A fixture is consistent when every rep returned the same number of loops.
  const counts = new Map<string, Set<number>>();
  for (const e of run.extraction) {
    (counts.get(e.id) ?? counts.set(e.id, new Set()).get(e.id)!).add(e.loops.length);
  }
  const consistent = [...counts.values()].filter((s) => s.size === 1).length;

  let memories = 0, noisy = 0, inventedDates = 0;
  for (const e of run.extraction) {
    const src = (textOf.get(e.id) ?? "").toLowerCase();
    for (const m of e.memories) {
      memories++;
      if (NOISE.test(m)) noisy++;
      for (const d of m.match(MONTHS) ?? []) {
        if (!src.includes(d.toLowerCase())) { inventedDates++; break; }
      }
    }
  }

  const shouldClose = run.closure.filter((c) => c.expectClosed);
  const shouldStay = run.closure.filter((c) => !c.expectClosed);

  return {
    loops: {
      precision: tp + fp ? +(tp / (tp + fp)).toFixed(2) : null,
      recall: tp + fn ? +(tp / (tp + fn)).toFixed(2) : null,
      tp, fp, fn, wrongDirection,
      consistentFixtures: `${consistent}/${counts.size}`,
    },
    closure: {
      closedWhenDone: `${shouldClose.filter((c) => c.closed).length}/${shouldClose.length}`,
      closedWhileOpen: `${shouldStay.filter((c) => c.closed).length}/${shouldStay.length}`,
    },
    memories: {
      perCapture: +(memories / run.extraction.length).toFixed(1),
      interfaceNoise: noisy,
      datesNotInSource: inventedDates,
    },
    falseLoops,
    missed,
  };
}

const verbose = process.argv.includes("-v");
for (const name of process.argv.slice(2).filter((a) => a !== "-v")) {
  const run: RunOutput = await Bun.file(join(dir, "runs", `${name}.local.json`)).json();
  const fx = await allFixtures(run.fixtures ?? "fixtures.local.json");
  const s = score(run, new Map(fx.map((f) => [f.id, f.text])));
  console.log(`\n=== ${name} (${run.reps} reps, ${run.fixtures ?? "fixtures.local.json"})`);
  console.log(JSON.stringify({ loops: s.loops, closure: s.closure, memories: s.memories }, null, 2));
  if (verbose) {
    console.log("false loops:\n  " + s.falseLoops.join("\n  "));
    console.log("missed:\n  " + s.missed.join("\n  "));
  }
}
