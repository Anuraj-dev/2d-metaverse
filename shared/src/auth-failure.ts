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
    error === "validation" &&
    keys.length === 3 &&
    "field" in value &&
    (value.field === "username" || value.field === "password") &&
    "reason" in value &&
    (value.reason === "required" ||
      value.reason === "too-short" ||
      value.reason === "too-long" ||
      (value.reason === "invalid-characters" && value.field === "username"))
  ) {
    return { error, field: value.field, reason: value.reason };
  }
  if (
    error === "suspended" &&
    keys.length === 2 &&
    "until" in value &&
    typeof value.until === "number" &&
    Number.isInteger(value.until) &&
    value.until > 0 &&
    value.until <= 8_640_000_000_000_000 &&
    Number.isFinite(value.until)
  ) {
    return { error, until: value.until };
  }
  if (
    (error === "validation" ||
      error === "username-taken" ||
      error === "invalid-credentials" ||
      error === "server-error") &&
    keys.length === 1
  ) {
    if (error === "validation") return { error: "validation" };
    if (error === "username-taken") return { error: "username-taken" };
    if (error === "invalid-credentials") return { error: "invalid-credentials" };
    return { error: "server-error" };
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
