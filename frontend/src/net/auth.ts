/** REST auth against the backend. Returns a JWT used for socket handshake + LiveKit tokens. */
import type { AuthTokenResponse } from "@metaverse/shared";
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
  return fetch(`${serverBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Explicit sign-up. Does NOT sign in — the caller signs in afterwards. */
export async function signUp(username: string, password: string): Promise<void> {
  const res = await postJson("/api/v1/signup", { username, password });
  if (!res.ok) {
    if (res.status === 400 || res.status === 409)
      throw new Error("That username is taken — try signing in instead.");
    throw new Error(`Sign up failed (${res.status}).`);
  }
}

/** Explicit sign-in. Returns the JWT. Never creates an account. */
export async function signIn(username: string, password: string): Promise<string> {
  const res = await postJson("/api/v1/signin", { username, password });
  if (!res.ok) throw new Error("Sign in failed — check your username and password.");
  const { token } = (await res.json()) as AuthTokenResponse;
  return token;
}
