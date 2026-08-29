/** REST auth against the backend. Returns a JWT used for socket handshake + LiveKit tokens. */
import { LIMITS, type AuthFailureResponse, type AuthTokenResponse } from "@metaverse/shared";
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
