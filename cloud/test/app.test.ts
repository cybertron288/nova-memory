import { test, expect } from "bun:test";
import { createApp } from "../src/app";
import { FakeLedger, fakeDeps } from "./fakes";

test("GET /health answers 200 when the ledger answers", async () => {
  const ledger = new FakeLedger();
  const res = await createApp(fakeDeps({ ledger })).request("/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(ledger.pings).toBe(1);
});

test("GET /health answers 503 when the ledger is down", async () => {
  const ledger = new FakeLedger();
  ledger.down = true;
  const res = await createApp(fakeDeps({ ledger })).request("/health");
  expect(res.status).toBe(503);
});
