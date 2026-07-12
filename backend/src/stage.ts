/**
 * Stage-zone geometry for server-authoritative broadcast authorization (PRD 17,
 * hardened in PRD 25.25).
 *
 * A publish-capable stage token is issued only when the requester's server-known
 * position falls inside one of the campus's stage/presenter broadcast zones — the
 * `stage` audience floor (where a spontaneous voice performer stands) and the
 * `presenter` podium (the explicit "Go Live" video slot), the two places a
 * performer legitimately broadcasts from.
 *
 * These rectangles are NOT hand-mirrored here anymore: they come from the
 * generated server geometry manifest (`manifest.stageZones`, emitted by
 * `frontend/scripts/gen_campus.py`; see `shared/src/geometry.ts` and
 * `backend/src/geometry.ts`). This module stays a pure decision function — plain
 * values in, boolean out, no I/O — so the caller feeds it the manifest zones and
 * the authoritative position (v1 client-trust caveat documented in
 * frontend/README.md → Audio model).
 */

/** An axis-aligned rectangle in world pixels (top-left origin). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

/**
 * True when (x, y) falls inside any of the given stage/presenter zones. Accepts
 * the manifest's `stageZones` (which carry extra `name`/`zoneType` fields —
 * structurally a superset of `Rect`).
 */
export function isInStageZone(zones: readonly Rect[], x: number, y: number): boolean {
  return zones.some((r) => inRect(r, x, y));
}

/**
 * True when a performer at (x, y) may broadcast to the stage, given the manifest
 * stage/presenter zones. The position must be the server's authoritative
 * last-accepted position — never a raw client-reported one.
 */
export function canPublishFromStage(zones: readonly Rect[], x: number, y: number): boolean {
  return isInStageZone(zones, x, y);
}
