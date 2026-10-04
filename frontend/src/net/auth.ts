/** REST auth against the backend. Returns a JWT used for socket handshake + LiveKit tokens. */
import { LIMITS, type AuthFailureResponse, type AuthProvidersResponse, type GoogleExchangeResponse, type GoogleExchangeRequest, type AuthTokenResponse } from "@metaverse/shared";
import { parseAuthFailureResponse } from "@metaverse/shared/auth-failure";
import { SERVER_URL } from "./config";
import { authTransportReason, getOperationalReporter } from "../operationalReport";

export { USE_MOCK } from "./config";

/** Backend base URL (empty in a misconfigured prod build — guarded before use). */
export const serverBase = SERVER_URL;

/**
 * The stored session JWT, or "" if unauthenticated. Single source of truth for the
 * socket handshake and LiveKit token requests — no bogus "dev" placeholder, which
 * a real backend would reject anyway.
 */
export function authToken(): string {
  return localStorage.getItem("token") ?? "";
}

async function postJson(path: string, body: unknown): Promise<Response> {
  try {
    return await fetch(`${serverBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    reportAuthTransport({ kind: "network" });
    throw new Error("Could not reach Hyprverse. Check your connection and try again.");
  }
}

/** One-liner bridge: classify an auth-transport failure and report it if notable. */
function reportAuthTransport(outcome: { kind: "network" } | { kind: "http"; status: number }): void {
  const reason = authTransportReason(outcome);
  if (reason) getOperationalReporter().reportAuthTransport(reason);
}

async function authFailure(response: Response): Promise<AuthFailureResponse | null> {
  try {
    return parseAuthFailureResponse(await response.json());
  } catch {
    return null;
  }
}

function failureMessage(failure: AuthFailureResponse | null): string {
  switch (failure?.error) {
    case "validation":
      if (!("field" in failure)) return "Check the username and password requirements, then try again.";
      if (failure.field === "username") {
        if (failure.reason === "required") return "Username is required.";
        if (failure.reason === "too-short") return `Username must be at least ${LIMITS.usernameMin} characters.`;
        if (failure.reason === "too-long") return `Username must be at most ${LIMITS.usernameMax} characters.`;
        return "Use only letters, numbers, underscores, and hyphens.";
      }
      if (failure.reason === "required") return "Password is required.";
      if (failure.reason === "too-short") return `Password must be at least ${LIMITS.passwordMin} characters.`;
      return `Password must be at most ${LIMITS.passwordMax} characters.`;
    case "username-taken":
      return "That username is taken. Try signing in instead.";
    case "invalid-credentials":
      return "Sign in failed. Check your username and password.";
    case "rate-limited":
      return `Too many attempts. Try again in ${failure.retryAfterSeconds} seconds.`;
    case "server-error":
      return "The server is having trouble. Try again.";
    case "suspended":
      return `Your account is suspended until ${new Date(failure.until).toLocaleString()}.`;
    default:
      return "The server is having trouble. Try again.";
  }
}

export class AuthError extends Error {
  readonly field: "username" | "password" | undefined;

  constructor(message: string, field?: "username" | "password") {
    super(message);
    this.name = "AuthError";
    this.field = field;
  }
}

/** Explicit sign-up. Does NOT sign in — the caller signs in afterwards. */
export async function signUp(username: string, password: string): Promise<void> {
  const res = await postJson("/api/v1/signup", { username, password });
  if (!res.ok) {
    reportAuthTransport({ kind: "http", status: res.status });
    const failure = await authFailure(res);
    const field = failure?.error === "username-taken"
      ? "username"
      : failure?.error === "validation" && "field" in failure ? failure.field : undefined;
    throw new AuthError(failureMessage(failure), field);
  }
}

/** Explicit sign-in. Returns the JWT. Never creates an account. */
export async function signIn(username: string, password: string): Promise<string> {
  const res = await postJson("/api/v1/signin", { username, password });
  if (!res.ok) {
    reportAuthTransport({ kind: "http", status: res.status });
    const failure = await authFailure(res);
    const field = failure?.error === "validation" && "field" in failure ? failure.field : undefined;
    throw new AuthError(failureMessage(failure), field);
  }
  const { token } = (await res.json()) as AuthTokenResponse;
  return token;
}

/** Unconfigured or unreachable providers leave password access available. */
export async function googleAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${serverBase}/api/v1/auth/providers`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return false;
    const providers = await response.json() as AuthProvidersResponse;
    return providers.google === true;
  } catch {
    return false;
  }
}

const GOOGLE_FLOW_KEY = "hyprverse-google-flow";

export function startGoogleSignIn(): void {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  sessionStorage.setItem(GOOGLE_FLOW_KEY, nonce);
  window.location.assign(`${serverBase}/api/v1/auth/google/start?client_nonce=${encodeURIComponent(nonce)}`);
}

/** Consume the short-lived ticket immediately, before any network operation. */
export function completeGoogleSignIn(): Promise<GoogleExchangeResponse> | null {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const code = fragment.get("google_code");
  const error = fragment.get("google_error");
  if (code === null && error === null) return null;
  fragment.delete("google_code");
  fragment.delete("google_error");
  const remaining = fragment.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${remaining ? `#${remaining}` : ""}`);
  const clientNonce = sessionStorage.getItem(GOOGLE_FLOW_KEY);
  sessionStorage.removeItem(GOOGLE_FLOW_KEY);
  if (error !== null || !code || !clientNonce) return Promise.reject(new Error("Google sign-in failed."));
  return exchangeGoogleCode(code, clientNonce);
}

async function exchangeGoogleCode(code: string, clientNonce: string): Promise<GoogleExchangeResponse> {
  const body: GoogleExchangeRequest = { code, clientNonce };
  const response = await postJson("/api/v1/auth/google/exchange", body);
  if (!response.ok) throw new Error("Google sign-in expired or failed. Please try again.");
  const session = await response.json() as GoogleExchangeResponse;
  if (!session.token || !session.username) throw new Error("Google sign-in failed.");
  return session;
}
