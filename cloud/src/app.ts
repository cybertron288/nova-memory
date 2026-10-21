import { Hono } from "hono";
import type { Config } from "./config";
import { LedgerUnavailable, type Ledger } from "./ledger";

export interface Deps {
  config: Config;
  now: () => number;
  ledger: Ledger;
  /** One JSON line per request. Never given a request or response body. */
  log: (line: Record<string, unknown>) => void;
}

export function createApp(deps: Deps): Hono {
  const app = new Hono();

  app.get("/health", async (c) => {
    try {
      await deps.ledger.ping();
      return c.json({ ok: true });
    } catch (e) {
      if (!(e instanceof LedgerUnavailable)) throw e;
      return c.json({ ok: false, error: "ledger unavailable" }, 503);
    }
  });

  return app;
}
