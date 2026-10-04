import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleIdentityVerifier } from "../src/google-identity.js";

let verifyGoogleIdentity = createGoogleIdentityVerifier();
beforeEach(() => { verifyGoogleIdentity = createGoogleIdentityVerifier(); });
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
function token(overrides: Record<string, unknown> = {}, audience = "client"): string {
  return jwt.sign({ nonce: "nonce", ...overrides }, privateKey, {
    algorithm: "RS256", keyid: "key", audience, issuer: "https://accounts.google.com", subject: "stable-subject", expiresIn: "5m"
  });
}
function mockKeys(): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ keys: [{ ...jwk, kid: "key", alg: "RS256", use: "sig" }] }))));
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("Google OIDC identity validation", () => {
  it("accepts a signed Google identity and returns only the stable subject", async () => {
    mockKeys();
    await expect(verifyGoogleIdentity(token(), "client", "nonce")).resolves.toBe("stable-subject");
  });
  it("rejects another application's identity", async () => {
    mockKeys();
    await expect(verifyGoogleIdentity(token({}, "other-client"), "client", "nonce")).rejects.toThrow();
  });
  it.each([{ nonce: "wrong" }, { azp: "other-client" }, { exp: 1 }, { iat: 9999999999 }])("rejects invalid bound claims %j", async (claims) => {
    mockKeys();
    // exp needs its own signing options to avoid duplicate expiresIn.
    const signed = "exp" in claims
      ? jwt.sign({ nonce: "nonce", ...claims }, privateKey, { algorithm: "RS256", keyid: "key", audience: "client", issuer: "https://accounts.google.com", subject: "stable-subject" })
      : token(claims);
    await expect(verifyGoogleIdentity(signed, "client", "nonce")).rejects.toThrow();
  });
  it("rejects unsigned tokens before fetching keys", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const unsigned = jwt.sign({ sub: "forged" }, "", { algorithm: "none" });
    await expect(verifyGoogleIdentity(unsigned, "client", "nonce")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Google signing key cache", () => {
  it("shares one fetch between concurrent identities and subsequent sign-ins", async () => {
    mockKeys();
    await Promise.all([verifyGoogleIdentity(token(), "client", "nonce"), verifyGoogleIdentity(token(), "client", "nonce")]);
    await verifyGoogleIdentity(token(), "client", "nonce");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("honors expiry and refuses stale keys when refresh fails", async () => {
    vi.useFakeTimers();
    mockKeys();
    await verifyGoogleIdentity(token(), "client", "nonce");
    vi.advanceTimersByTime(301_000);
    vi.mocked(fetch).mockRejectedValue(new Error("unavailable"));
    await expect(verifyGoogleIdentity(token(), "client", "nonce")).rejects.toThrow("unavailable");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("bounds unknown-key refreshes but allows key rotation after cooldown", async () => {
    vi.useFakeTimers();
    mockKeys();
    await verifyGoogleIdentity(token(), "client", "nonce");
    const rotated = jwt.sign({ nonce: "nonce" }, privateKey, { algorithm: "RS256", keyid: "rotated", audience: "client", issuer: "https://accounts.google.com", subject: "stable-subject", expiresIn: "5m" });
    await expect(verifyGoogleIdentity(rotated, "client", "nonce")).rejects.toThrow("unknown identity key");
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ keys: [{ ...jwk, kid: "rotated" }] })));
    await expect(verifyGoogleIdentity(rotated, "client", "nonce")).resolves.toBe("stable-subject");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
