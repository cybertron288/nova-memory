import { test, expect } from "bun:test";
import { generateKeyPair } from "jose";
import { sessionVerifier, Unauthorized } from "../src/session";
import { ISSUER, mintToken, testJwks } from "./fakes";

const verify = sessionVerifier(testJwks, ISSUER);

test("a valid token yields the user id and email", async () => {
  const token = await mintToken({ sub: "u1", email: "a@example.com" });
  expect(await verify(`Bearer ${token}`)).toEqual({ userId: "u1", email: "a@example.com" });
});

test("a missing header is Unauthorized", async () => {
  await expect(verify(undefined)).rejects.toBeInstanceOf(Unauthorized);
});

test("a non-Bearer header is Unauthorized", async () => {
  const token = await mintToken({ sub: "u1" });
  await expect(verify(`Basic ${token}`)).rejects.toBeInstanceOf(Unauthorized);
});

test("an expired token is Unauthorized", async () => {
  const token = await mintToken({ sub: "u1" }, { expiresAt: Math.floor(Date.now() / 1000) - 1 });
  await expect(verify(`Bearer ${token}`)).rejects.toBeInstanceOf(Unauthorized);
});

test("a token from another issuer is Unauthorized", async () => {
  const token = await mintToken({ sub: "u1" }, { issuer: "https://elsewhere.supabase.co/auth/v1" });
  await expect(verify(`Bearer ${token}`)).rejects.toBeInstanceOf(Unauthorized);
});

test("a token signed by another key is Unauthorized", async () => {
  const other = await generateKeyPair("ES256");
  const token = await mintToken({ sub: "u1" }, { key: other.privateKey });
  await expect(verify(`Bearer ${token}`)).rejects.toBeInstanceOf(Unauthorized);
});
