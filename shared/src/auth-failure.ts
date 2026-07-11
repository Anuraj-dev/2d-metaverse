import { RATE_LIMITS } from "./constants.js";
import type { AuthFailureResponse } from "./rest.js";

/**
 * Zod-free browser parser for the bounded auth failure contract. The backend
 * continues to own validation through the schema in rest.ts; this subpath lets
 * the landing bundle consume untrusted responses without importing Zod.
 */
export function parseAuthFailureResponse(value: unknown): AuthFailureResponse | null {
  if (typeof value !== "object" || value === null || !("error" in value)) return null;
  const keys = Object.keys(value);
  const error = value.error;
  if (
    (error === "validation" ||
      error === "username-taken" ||
      error === "invalid-credentials" ||
      error === "server-error") &&
    keys.length === 1
  ) {
    return { error };
  }
  if (
    error === "rate-limited" &&
    keys.length === 2 &&
    "retryAfterSeconds" in value &&
    typeof value.retryAfterSeconds === "number" &&
    Number.isInteger(value.retryAfterSeconds) &&
    value.retryAfterSeconds >= 1 &&
    value.retryAfterSeconds <= Math.ceil(RATE_LIMITS.authWindowMs / 1000)
  ) {
    return { error, retryAfterSeconds: value.retryAfterSeconds };
  }
  return null;
}
