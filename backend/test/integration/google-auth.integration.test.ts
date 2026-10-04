import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "../../src/config.js";
import { pool } from "../../src/db.js";
import { redis } from "../../src/redis.js";
import { api, startServer, teardown, type TestServer } from "./helpers.js";

vi.mock("../../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config.js")>();
  return { config: { ...actual.config, GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret",
    GOOGLE_REDIRECT_URI: "http://localhost:3001/api/v1/auth/google/callback", GOOGLE_FRONTEND_REDIRECT_URI: "http://localhost:5173/" } };
});
const observedFailures = vi.hoisted(() => [] as unknown[]);
vi.mock("../../src/request-logger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/request-logger.js")>();
  return { ...actual, requestLog: (...args: Parameters<typeof actual.requestLog>) => {
    const logger = actual.requestLog(...args);
    return { ...logger, warn: (fields: unknown) => { observedFailures.push(fields); } };
  } };
});
const subject = `test-${randomUUID()}`;
vi.mock("../../src/google-identity.js", () => ({ verifyGoogleIdentity: vi.fn() }));
import { verifyGoogleIdentity } from "../../src/google-identity.js";
const originalFetch = globalThis.fetch;
const random = (): string => randomBytes(32).toString("base64url");
const digest = (value: string): string => createHash("sha256").update(value).digest("base64url");
let server: TestServer;
let userId: string | undefined;
beforeAll(async () => {
  server = await startServer();
  vi.mocked(verifyGoogleIdentity).mockResolvedValue(subject);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id IN (SELECT user_id FROM oauth_identities WHERE subject = $1)", [subject]);
  await teardown(server);
});
async function start(): Promise<{ state: string; cookie: string; clientNonce: string }> {
  const clientNonce = random();
  const response = await originalFetch(`${server.baseUrl}/api/v1/auth/google/start?client_nonce=${clientNonce}`, { redirect: "manual" });
  const location = response.headers.get("location");
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!location || !cookie) throw new Error("missing redirect or cookie");
  const state = new URL(location).searchParams.get("state");
  if (!state) throw new Error("missing state");
  return { state, cookie, clientNonce };
}
async function callback(flow: Awaited<ReturnType<typeof start>>, cookie = flow.cookie): Promise<URL> {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id_token: "mocked-and-verified-separately" }))));
  const response = await originalFetch(`${server.baseUrl}/api/v1/auth/google/callback?state=${flow.state}&code=provider-code`, { redirect: "manual", headers: { cookie } });
  const location = response.headers.get("location");
  if (!location) throw new Error("missing callback redirect");
  vi.unstubAllGlobals();
  return new URL(location);
}
async function ticket(): Promise<{ code: string; clientNonce: string }> {
  const flow = await start();
  const url = await callback(flow);
  const code = new URLSearchParams(url.hash.slice(1)).get("google_code");
  if (!code) throw new Error(`callback failed: ${url.hash}`);
  return { code, clientNonce: flow.clientNonce };
}
describe("Google sign-in HTTP flow", () => {
  it("advertises configured provider", async () => {
    expect(await api(server.baseUrl, "/api/v1/auth/providers")).toEqual({ status: 200, json: { google: true } });
    expect(config.GOOGLE_CLIENT_ID).toBe("test-client");
  });
  it("rejects callback cookie mismatch and replayed state", async () => {
    const flow = await start();
    expect((await callback(flow, "google_oauth_browser=wrong")).hash).toBe("#google_error=oauth-failed");
    expect((await callback(flow)).hash).toBe("#google_error=oauth-failed");
    expect(observedFailures.slice(-2)).toEqual([
      { module: "google-auth", event: "oauth-callback-failed", stage: "browser-binding" },
      { module: "google-auth", event: "oauth-callback-failed", stage: "state-validation" }
    ]);
  });
  it("rejects missing and mismatched completion verifier", async () => {
    const completion = await ticket();
    expect((await api(server.baseUrl, "/api/v1/auth/google/exchange", { body: { code: completion.code } })).status).toBe(400);
    expect((await api(server.baseUrl, "/api/v1/auth/google/exchange", { body: { ...completion, clientNonce: random() } })).status).toBe(401);
  });
  it("exchanges once, reuses stable identity and creates no local password", async () => {
    const completion = await ticket();
    const success = await api(server.baseUrl, "/api/v1/auth/google/exchange", { body: completion });
    expect(success.status).toBe(200);
    expect(success.json).toMatchObject({ token: expect.any(String), username: expect.stringMatching(/^student_/) });
    expect((await api(server.baseUrl, "/api/v1/auth/google/exchange", { body: completion })).status).toBe(401);
    await ticket();
    const rows = await pool.query<{ id: string; password_hash: string | null }>("SELECT u.id, u.password_hash FROM users u JOIN oauth_identities i ON i.user_id = u.id WHERE i.subject = $1", [subject]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.password_hash).toBeNull();
    userId = rows.rows[0]?.id;
  });
  it("rejects a suspended user at completion and callback", async () => {
    if (!userId) throw new Error("missing provisioned user");
    const completion = await ticket();
    await pool.query("INSERT INTO suspensions (user_id, suspended_until, actor_id) VALUES ($1, now() + interval '1 hour', $1)", [userId]);
    expect((await api(server.baseUrl, "/api/v1/auth/google/exchange", { body: completion })).status).toBe(403);
    expect((await callback(await start())).hash).toBe("#google_error=oauth-failed");
    expect(observedFailures.at(-1)).toEqual({ module: "google-auth", event: "oauth-callback-failed", stage: "suspended" });
    expect(await redis.get(`oauth:ticket:${digest(completion.code)}`)).toBeNull();
  });
});
