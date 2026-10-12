// Copies chosen versions out of the live store into eval/fixtures.local.json,
// so prompt changes can be scored against real captures without touching the
// store again. The output holds captured content: it is gitignored and stays
// on this machine.
//
//   bun eval/export.ts <version-id-prefix>...
import { openDb, fieldKey, decryptField } from "../src/db";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Fixture } from "./types";

const prefixes = process.argv.slice(2);
if (prefixes.length === 0) {
  console.error("usage: bun eval/export.ts <version-id-prefix>...");
  process.exit(1);
}

const db = await openDb(join(homedir(), "Library", "Application Support", "Nova", "memory.db"));
const key = await fieldKey();
const dec = (s: string | null) => (s ? decryptField(s, key) : "");

const fixtures: Fixture[] = [];
for (const p of prefixes) {
  const v = db.query(
    `SELECT v.id, v.content, v.committed_at, t.source_app, t.source_title, t.source_url
       FROM memory_versions v JOIN memory_threads t ON t.id = v.thread_id
      WHERE v.id LIKE ?`,
  ).get(`${p}%`) as any;
  if (!v) throw new Error(`no version matches ${p}`);
  fixtures.push({
    id: p,
    text: dec(v.content),
    ctx: {
      app: v.source_app,
      title: dec(v.source_title),
      url: v.source_url ? dec(v.source_url) : null,
      capturedAt: v.committed_at,
    },
  });
}

const out = join(import.meta.dir, "fixtures.local.json");
await Bun.write(out, JSON.stringify(fixtures, null, 2));
console.error(`wrote ${fixtures.length} fixtures to ${out}`);
