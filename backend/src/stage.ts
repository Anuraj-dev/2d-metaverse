/**
 * Stage-zone geometry for server-authoritative broadcast authorization (PRD 17).
 *
 * A publish-capable stage token is issued only when the requester's server-known
 * position falls inside one of these rectangles. They mirror the `stage` object
 * layer of `frontend/public/assets/maps/campus.json` — the `stage_zone` audience
 * floor (where a spontaneous voice performer stands) and the `presenter_zone`
 * podium (the explicit "Go Live" video slot) — the two places a performer
 * legitimately broadcasts from. This is the only server-side copy of the stage
 * bounds; keep it in sync if the campus stage is ever re-authored (v1 client-trust
 * caveat documented in frontend/README.md → Audio model).
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const STAGE_ZONE: Rect = { x: 1312, y: 256, width: 576, height: 448 };
export const PRESENTER_ZONE: Rect = { x: 1440, y: 32, width: 336, height: 224 };

const STAGE_PUBLISH_ZONES: readonly Rect[] = [STAGE_ZONE, PRESENTER_ZONE];

function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

/** True when (x, y) is inside a zone a performer may broadcast to the stage from. */
export function canPublishFromStage(x: number, y: number): boolean {
  return STAGE_PUBLISH_ZONES.some((r) => inRect(r, x, y));
}

/**
 * True when (x, y) is anywhere in the stage gathering (audience floor or podium).
 * Used by the social-arrival read model (PRD 25.26) to count students gathered at
 * the stage — a broader test than `canPublishFromStage` (same rects today, but the
 * intent is "present at the stage", not "authorized to broadcast").
 */
export function isInStageZone(x: number, y: number): boolean {
  return STAGE_PUBLISH_ZONES.some((r) => inRect(r, x, y));
}
