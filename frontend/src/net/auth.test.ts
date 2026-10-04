import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signUp, signIn, googleAvailable, completeGoogleSignIn } from "./auth";

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
  window.history.replaceState(null, "", "/");
  localStorage.clear();
  sessionStorage.clear();
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
  it("treats unavailable Google configuration and network errors as disabled", async () => {
    fetchMock.mockReturnValueOnce(ok({ google: false })).mockRejectedValueOnce(new Error("offline"));
    await expect(googleAvailable()).resolves.toBe(false);
    await expect(googleAvailable()).resolves.toBe(false);
  });

  it("consumes Google tickets before exchanging and never stores them", async () => {
    sessionStorage.setItem("hyprverse-google-flow", "browser-flow-secret");
    window.history.replaceState(null, "", "/?invite=campus#google_code=one-use-ticket");
    fetchMock.mockReturnValue(ok({ token: "JWT", username: "google-user" }));
    const completion = completeGoogleSignIn();
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?invite=campus");
    await expect(completion).resolves.toEqual({ token: "JWT", username: "google-user" });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/auth/google/exchange"), expect.objectContaining({ body: JSON.stringify({ code: "one-use-ticket", clientNonce: "browser-flow-secret" }) }));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(completeGoogleSignIn()).toBeNull();
  });

  it("clears Google failures without requesting or leaking callback details", async () => {
    window.history.replaceState(null, "", "/#google_error=oauth-failed");
    await expect(completeGoogleSignIn()).rejects.toThrow("Google sign-in failed.");
    expect(window.location.hash).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unsolicited Google callbacks without a browser flow secret", async () => {
    window.history.replaceState(null, "", "/#google_code=attacker-ticket");
    await expect(completeGoogleSignIn()).rejects.toThrow("Google sign-in failed.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });

  it("rejects expired Google exchanges without storing a session", async () => {
    sessionStorage.setItem("hyprverse-google-flow", "browser-flow-secret");
    window.history.replaceState(null, "", "/#google_code=expired");
    fetchMock.mockReturnValue(fail(401));
    await expect(completeGoogleSignIn()).rejects.toThrow(/expired or failed/);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

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
    fetchMock.mockReturnValue(fail(400, { error: "validation", field: "username", reason: "too-short" }));
    await expect(signUp("x", "y")).rejects.toMatchObject({ field: "username", message: expect.stringMatching(/at least 3/i) });
  });

  it("surfaces suspension expiry truthfully", async () => {
    const until = 1_800_000_000_000;
    fetchMock.mockReturnValue(fail(403, { error: "suspended", until }));
    await expect(signIn("alice", "password1")).rejects.toThrow(new Date(until).toLocaleString());
  });

  it("rejects an out-of-range suspension timestamp instead of rendering an invalid date", async () => {
    fetchMock.mockReturnValue(fail(403, { error: "suspended", until: 8_640_000_000_000_001 }));
    await expect(signIn("alice", "password1")).rejects.toThrow(/server is having trouble/i);
    await expect(signIn("alice", "password1")).rejects.not.toThrow(/invalid date/i);
  });

  it("includes bounded retry guidance when auth is rate limited", async () => {
    fetchMock.mockReturnValue(
      fail(429, { error: "rate-limited", retryAfterSeconds: 37 }),
    );
    await expect(signIn("x", "y")).rejects.toThrow(/37 seconds/i);
  });

  it("bounds auth and provider requests with timeout signals", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockReturnValueOnce(ok({ token: "JWT" })).mockReturnValueOnce(ok({ google: true }));
    await signIn("alice", "password1");
    await googleAvailable();
    expect(timeout).toHaveBeenNthCalledWith(1, 15_000);
    expect(timeout).toHaveBeenNthCalledWith(2, 5_000);
    timeout.mockRestore();
  });

  it("restores friendly retry guidance when auth times out", async () => {
    fetchMock.mockRejectedValue(new DOMException("deadline", "TimeoutError"));
    await expect(signIn("alice", "password1")).rejects.toThrow(/check your connection and try again/i);
    await expect(googleAvailable()).resolves.toBe(false);
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
