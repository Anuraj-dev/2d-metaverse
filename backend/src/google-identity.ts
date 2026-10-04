import { createPublicKey } from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { z } from "zod";

const keysSchema = z.object({ keys: z.array(z.object({
  kid: z.string(), kty: z.literal("RSA"), n: z.string(), e: z.string(),
  alg: z.literal("RS256").optional(), use: z.literal("sig").optional()
})) });

/** Cache public signing keys briefly and share concurrent fetches. No stale fallback. */
export function createGoogleIdentityVerifier(): (token: string, audience: string, nonce: string) => Promise<string> {
  let cached: z.infer<typeof keysSchema> | undefined;
  let expiresAt = 0;
  let fetchedAt = 0;
  let pending: Promise<z.infer<typeof keysSchema>> | undefined;
  async function fetchKeys(): Promise<z.infer<typeof keysSchema>> {
    if (pending) return pending;
    pending = (async () => {
      const response = await fetch("https://www.googleapis.com/oauth2/v3/certs", { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("identity keys unavailable");
      const keys = keysSchema.parse(await response.json());
      const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(response.headers.get("cache-control") ?? "");
      const ttlSeconds = maxAge?.[1] ? Math.min(300, Number(maxAge[1])) : 300;
      cached = keys;
      fetchedAt = Date.now();
      expiresAt = fetchedAt + ttlSeconds * 1000;
      return keys;
    })();
    try { return await pending; } finally { pending = undefined; }
  }
  return async (token, audience, nonce) => {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || decoded.header.alg !== "RS256" || !decoded.header.kid) throw new Error("invalid identity");
    let keys = cached && Date.now() < expiresAt ? cached : await fetchKeys();
    let key = keys.keys.find((candidate) => candidate.kid === decoded.header.kid);
    // Permit rotation refresh, while unknown-key floods cannot bypass the cache.
    if (!key && Date.now() - fetchedAt >= 30_000) {
      keys = await fetchKeys();
      key = keys.keys.find((candidate) => candidate.kid === decoded.header.kid);
    }
    if (!key) throw new Error("unknown identity key");
    const publicKey = createPublicKey({ key: { kty: key.kty, n: key.n, e: key.e }, format: "jwk" });
    const payload = jwt.verify(token, publicKey, {
      algorithms: ["RS256"], audience, issuer: ["https://accounts.google.com", "accounts.google.com"]
    }) as JwtPayload;
    if (payload.nonce !== nonce || typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255 ||
        typeof payload.exp !== "number" || typeof payload.iat !== "number" || payload.iat > Date.now() / 1000 + 60 ||
        (payload.azp !== undefined && payload.azp !== audience) ||
        (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== audience)) {
      throw new Error("invalid identity claims");
    }
    return payload.sub;
  };
}
export const verifyGoogleIdentity = createGoogleIdentityVerifier();
