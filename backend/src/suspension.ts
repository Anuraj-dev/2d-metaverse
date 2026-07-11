/**
 * Pure suspension-state evaluation (PRD 25.14). Plain values in, boolean out —
 * no DB, no clock of its own. The enforcement points (signin, socket handshake,
 * media-token) read the current-state suspension row and ask this whether it is
 * still in force at `now`, so a row whose expiry has quietly passed is treated as
 * not-suspended even before a cleanup job removes it (defence in depth).
 */

/** The fields of a suspension record this decision depends on. */
export interface SuspensionRecord {
  /** Epoch ms at which access is restored. */
  suspendedUntil: number;
}

/** True when `record` exists and its expiry is strictly in the future at `now`. */
export function isSuspended(record: SuspensionRecord | null | undefined, now: number): boolean {
  return record != null && record.suspendedUntil > now;
}
