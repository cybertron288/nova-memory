import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { hashIp } from "../src/device";

test("an IP hash depends on the server secret, so it cannot be reversed by enumeration", () => {
  const a = hashIp("203.0.113.7", "secret-one-secret-one-secret-one");
  const b = hashIp("203.0.113.7", "secret-two-secret-two-secret-two");
  expect(a).not.toBe(b);
  expect(a).not.toBe(createHash("sha256").update("ip:203.0.113.7").digest("hex"));
  expect(hashIp("203.0.113.7", "secret-one-secret-one-secret-one")).toBe(a);
});
