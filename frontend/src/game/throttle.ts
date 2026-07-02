/**
 * Emission throttling: pure clock → "is this tick due?".
 *
 * Extracted from WorldScene's inline timestamp checks (network move sends and the
 * positions bus snapshot) so the cadence rule is tested once, not re-derived at
 * every call site.
 */

/** Positions bus snapshot cadence (~15 Hz). */
export const POSITIONS_INTERVAL_MS = 66;
/** Network move-send cadence (~12.5 Hz). */
export const MOVE_SEND_INTERVAL_MS = 80;

/** True when at least `intervalMs` has elapsed since `last`. */
export function throttleReady(now: number, last: number, intervalMs: number): boolean {
  return now - last >= intervalMs;
}
