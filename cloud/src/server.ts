// The entrypoint Vercel's Bun runtime detects: one Bun.serve() at startup.
import { createApp } from "./app";
import { loadConfig } from "./config";
import { SupabaseLedger } from "./ledger";

const config = loadConfig(process.env);

Bun.serve({
  fetch: createApp({
    config,
    now: Date.now,
    ledger: new SupabaseLedger(config),
    log: (line) => console.log(JSON.stringify(line)),
  }).fetch,
});
