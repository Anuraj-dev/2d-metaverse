import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signUp, signIn } from "./auth";

const fetchMock = vi.fn();

// Spy on the operational reporter while keeping the real pure classification
// (authTransportReason) that auth.ts depends on.
const reportAuthTransport = vi.hoisted(() => vi.fn());
vi.mock("../operationalReport", async (importActual) => {
  const actual = await importActual<typeof import("../operationalReport")>();
  return {
    ...actual,
    getOperationalReporter: () => ({
      reportAuthTransport,
      reportReconnect: vi.fn(),
      reportMediaPublishFailure: vi.fn(),
    }),
  };
});

beforeEach(() => {
  fetchMock.mockReset();
  reportAuthTransport.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const ok = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response);
const fail = (status: number, body: unknown = {}) =>
  Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  } as Response);

describe("auth", () => {
  it("signIn posts to /signin and returns the token without signing up", async () => {
    fetchMock.mockReturnValue(ok({ token: "JWT" }));
    const token = await signIn("alice", "pw");

    expect(token).toBe("JWT");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch was not called");
    const url = String(call[0]);
    expect(url).toContain("/api/v1/signin");
    expect(url).not.toContain("/signup");
  });

  it("signUp posts credentials to /signup", async () => {
    fetchMock.mockReturnValue(ok({}));
    await signUp("bob", "pw");

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch was not called");
    const [url, init] = call;
    expect(String(url)).toContain("/api/v1/signup");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      username: "bob",
      password: "pw",
    });
  });

  it("signIn surfaces a friendly error on bad credentials", async () => {
    fetchMock.mockReturnValue(fail(401, { error: "invalid-credentials" }));
    await expect(signIn("x", "y")).rejects.toThrow(/check your username/i);
  });

  it("signUp flags a taken username", async () => {
    fetchMock.mockReturnValue(fail(409, { error: "username-taken" }));
    await expect(signUp("x", "y")).rejects.toThrow(/taken/i);
  });

  it("distinguishes validation failures from a taken username", async () => {
    fetchMock.mockReturnValue(fail(400, { error: "validation" }));
    await expect(signUp("x", "y")).rejects.toThrow(/requirements/i);
  });

  it("includes bounded retry guidance when auth is rate limited", async () => {
    fetchMock.mockReturnValue(
      fail(429, { error: "rate-limited", retryAfterSeconds: 37 }),
    );
    await expect(signIn("x", "y")).rejects.toThrow(/37 seconds/i);
  });

  it("reports network failures without exposing the fetch exception", async () => {
    fetchMock.mockRejectedValue(new TypeError("secret upstream address"));
    await expect(signIn("x", "y")).rejects.toThrow(/could not reach hyprverse/i);
    await expect(signIn("x", "y")).rejects.not.toThrow(/secret upstream/i);
  });

  it("falls back safely when a server error body is malformed", async () => {
    fetchMock.mockReturnValue(fail(500, { error: "database exploded" }));
    await expect(signUp("x", "y")).rejects.toThrow(/server is having trouble/i);
  });

  it("reports a bounded auth-transport reason on transport failures", async () => {
    fetchMock.mockReturnValue(fail(401, { error: "invalid-credentials" }));
    await expect(signIn("x", "y")).rejects.toThrow();
    expect(reportAuthTransport).toHaveBeenCalledWith("unauthorized");

    reportAuthTransport.mockReset();
    fetchMock.mockReturnValue(fail(503, {}));
    await expect(signUp("x", "y")).rejects.toThrow();
    expect(reportAuthTransport).toHaveBeenCalledWith("server-error");

    reportAuthTransport.mockReset();
    fetchMock.mockRejectedValue(new TypeError("upstream down"));
    await expect(signIn("x", "y")).rejects.toThrow();
    expect(reportAuthTransport).toHaveBeenCalledWith("network");
  });

  it("does not report expected app-level auth outcomes", async () => {
    fetchMock.mockReturnValue(fail(400, { error: "validation" }));
    await expect(signUp("x", "y")).rejects.toThrow();
    fetchMock.mockReturnValue(fail(409, { error: "username-taken" }));
    await expect(signUp("x", "y")).rejects.toThrow();
    fetchMock.mockReturnValue(fail(429, { error: "rate-limited", retryAfterSeconds: 5 }));
    await expect(signIn("x", "y")).rejects.toThrow();
    expect(reportAuthTransport).not.toHaveBeenCalled();
  });
});
