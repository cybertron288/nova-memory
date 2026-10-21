// The entrypoint Vercel's Bun runtime detects: one Bun.serve() at startup.
import { createRemoteJWKSet } from "jose";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { SupabaseLedger } from "./ledger";
import { sessionVerifier } from "./session";
import { httpUpstream } from "./upstream";

const config = loadConfig(process.env);

Bun.serve({
  fetch: createApp({
    config,
    now: Date.now,
    ledger: new SupabaseLedger(config),
    verifySession: sessionVerifier(createRemoteJWKSet(new URL(config.jwksUrl)), `${config.supabaseUrl}/auth/v1`),
    upstream: httpUpstream(config),
    log: (line) => console.log(JSON.stringify(line)),
  }).fetch,
});
