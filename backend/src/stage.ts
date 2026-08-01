/**
 * Stage-zone geometry for server-authoritative broadcast authorization (PRD 17,
 * hardened in PRD 25.25).
 *
 * A publish-capable stage token is issued only when the requester's server-known
 * position falls inside the campus's `presenter` platform. The wider `stage`
 * rectangle is still used for auditorium presence and audio, but sitting in the
 * audience must never grant broadcast permission.
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

/** A generated auditorium zone, tagged by its gameplay purpose. */
export interface StageZone extends Rect {
  zoneType: "stage" | "presenter";
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
 * True when a performer at (x, y) is on the presenter platform and may broadcast.
 * The position must be the server's authoritative
 * last-accepted position — never a raw client-reported one.
 */
export function canPublishFromStage(zones: readonly StageZone[], x: number, y: number): boolean {
  return zones.some((zone) => zone.zoneType === "presenter" && inRect(zone, x, y));
}
