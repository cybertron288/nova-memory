// Supabase access tokens are JWTs signed with the project's asymmetric key, so
// they verify against the published JWKS with no database call.
import { jwtVerify, type JWTVerifyGetKey } from "jose";

export interface Session { userId: string; email: string | null }

export type VerifySession = (authorization: string | undefined) => Promise<Session>;

export class Unauthorized extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Unauthorized";
  }
}

export function sessionVerifier(jwks: JWTVerifyGetKey, issuer: string): VerifySession {
  return async (authorization) => {
    const token = authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) throw new Unauthorized("no bearer token");
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience: "authenticated" });
      if (typeof payload.sub !== "string" || payload.sub === "") throw new Unauthorized("token has no subject");
      return { userId: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
    } catch (e) {
      if (e instanceof Unauthorized) throw e;
      throw new Unauthorized(e instanceof Error ? e.message : String(e));
    }
  };
}
