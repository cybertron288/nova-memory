// The entrypoint. Vercel's Hono preset (picked because hono is a dependency)
// serves this module's default export on the Bun runtime set in vercel.json.
import type { Hono } from "hono";
import { createRemoteJWKSet } from "jose";
import { createApp } from "./proxy";
import { loadConfig } from "./config";
import { SupabaseLedger } from "./ledger";
import { sessionVerifier } from "./session";
import { httpUpstream } from "./upstream";

const config = loadConfig(process.env);

const app: Hono = createApp({
  config,
  now: Date.now,
  ledger: new SupabaseLedger(config),
  verifySession: sessionVerifier(createRemoteJWKSet(new URL(config.jwksUrl)), `${config.supabaseUrl}/auth/v1`),
  upstream: httpUpstream(config),
  log: (line) => console.log(JSON.stringify(line)),
});

export default app;
