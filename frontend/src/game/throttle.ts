/**
 * Emission throttling: pure clock → "is this tick due?".
 *
 * Extracted from WorldScene's inline timestamp checks. The two cadences keep
 * their historical boundary semantics *exactly* — they differ, and the
 * difference is observable on quantized frame timestamps (e.g. four exact 20ms
 * frames on a 50Hz display land on 80ms: strict `>` sends at 100ms, `>=` would
 * send at 80ms):
 *  - positions snapshot: inclusive (`>=`) — due at exactly 66ms
 *  - network move send: strict (`>`) — NOT due at exactly 80ms
 */

/** Positions bus snapshot cadence (~15 Hz). */
export const POSITIONS_INTERVAL_MS = 66;
/** Network move-send cadence (~12.5 Hz). */
export const MOVE_SEND_INTERVAL_MS = 80;

/** True when at least 66ms has elapsed since the last snapshot (inclusive). */
export function positionsEmitDue(now: number, last: number): boolean {
  return now - last >= POSITIONS_INTERVAL_MS;
}

/** True when strictly more than 80ms has elapsed since the last send. */
export function moveSendDue(now: number, last: number): boolean {
  return now - last > MOVE_SEND_INTERVAL_MS;
}
