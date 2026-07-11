/** REST auth against the backend. Returns a JWT used for socket handshake + LiveKit tokens. */
import {
  authFailureResponseSchema,
  type AuthFailureResponse,
  type AuthTokenResponse,
} from "@metaverse/shared";
import { SERVER_URL } from "./config";

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
    throw new Error("Could not reach Hyprverse. Check your connection and try again.");
  }
}

async function authFailure(response: Response): Promise<AuthFailureResponse | null> {
  try {
    const parsed = authFailureResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function failureMessage(failure: AuthFailureResponse | null): string {
  switch (failure?.error) {
    case "validation":
      return "Check the username and password requirements, then try again.";
    case "username-taken":
      return "That username is taken — try signing in instead.";
    case "invalid-credentials":
      return "Sign in failed — check your username and password.";
    case "rate-limited":
      return `Too many attempts. Try again in ${failure.retryAfterSeconds} seconds.`;
    case "server-error":
    default:
      return "The server is having trouble. Try again.";
  }
}

/** Explicit sign-up. Does NOT sign in — the caller signs in afterwards. */
export async function signUp(username: string, password: string): Promise<void> {
  const res = await postJson("/api/v1/signup", { username, password });
  if (!res.ok) {
    throw new Error(failureMessage(await authFailure(res)));
  }
}

/** Explicit sign-in. Returns the JWT. Never creates an account. */
export async function signIn(username: string, password: string): Promise<string> {
  const res = await postJson("/api/v1/signin", { username, password });
  if (!res.ok) throw new Error(failureMessage(await authFailure(res)));
  const { token } = (await res.json()) as AuthTokenResponse;
  return token;
}
