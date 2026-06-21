/**
 * Centralised runtime config. Mock mode is **development-only**; production must
 * be given a real backend URL and never silently falls back to a simulated world.
 *
 * Hosting (Vercel etc.) must set:
 *   VITE_USE_MOCK=0
 *   VITE_SERVER_URL=https://api.example.com
 */
export const IS_DEV = import.meta.env.DEV;

const mockRequested = (import.meta.env.VITE_USE_MOCK ?? "1") !== "0";

/** True only in development with mock not explicitly disabled. Always false in prod. */
export const USE_MOCK = IS_DEV && mockRequested;

const envServerUrl = (import.meta.env.VITE_SERVER_URL ?? "").trim();

/** Backend base URL. Falls back to localhost in dev only; empty in prod if unset. */
export const SERVER_URL = envServerUrl || (IS_DEV ? "http://localhost:3001" : "");

/** A production build that needs a backend but has no URL — render a clear error. */
export const MISCONFIGURED = !USE_MOCK && !SERVER_URL;

/** Returns the backend URL or throws a clear error (used when real networking starts). */
export function assertServerUrl(): string {
  if (!SERVER_URL)
    throw new Error(
      "VITE_SERVER_URL is required — production builds must point at the backend " +
        "(mock mode is development-only)."
    );
  return SERVER_URL;
}
