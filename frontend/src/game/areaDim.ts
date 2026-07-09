/**
 * Area focus dim (PRD 24): the pure decision layer for "spotlight the room you
 * are in". When the player stands inside a named area (a room interior, the
 * Stage, or the arcade hall) everything OUTSIDE that area is dimmed a touch, so
 * the space you are in reads as the focus. Outdoors there is no focus area, so
 * nothing dims.
 *
 * This module owns only the decisions — which area (if any) contains the player,
 * and the geometry of the "everything else" region to darken. WorldScene is the
 * glue: it samples the player point each frame, and when the containing area
 * changes it draws the returned bands as a multiply overlay and fades it in/out.
 *
 * Pure + framework-free (no Phaser, net, or DOM), so every case is a trivial
 * table-driven vitest — same as the other `game/` modules. The area rectangles
 * are the SAME rects that drive audio zones (room bounds) plus the Stage/arcade
 * interiors; there is no second registry.
 */
import { AREA_NAMES, areaIdForRoom } from "@metaverse/shared";
import { rectContains, type Rect } from "./zones";

/** A named focus area: an id (room id / "stage" / "arcade") and its rectangle. */
export interface DimArea {
  id: string;
  rect: Rect;
}

/** The dim decision for a sampled point. */
export interface DimState {
  /** True when the point is inside a focus area (⇒ dim everything outside it). */
  active: boolean;
  /** The containing area's id, or null outdoors. */
  areaId: string | null;
  /** The containing area's rect (the un-dimmed hole), or null outdoors. */
  areaRect: Rect | null;
}

/** Target brightness of the dimmed (outside-area) region: subtle, not theatrical. */
export const DIM_BRIGHTNESS = 0.75;

/** Soft cross-fade for the dim as the player enters/leaves an area. */
export const DIM_FADE_MS = 300;

/**
 * The focus area containing the point, or an inactive state outdoors. Last match
 * wins if areas overlap (matches the forward-scan-last-write convention used by
 * `zones.findRoomArea`); campus areas don't overlap in practice.
 */
export function areaDimAt(
  areas: readonly DimArea[],
  px: number,
  py: number
): DimState {
  let found: DimArea | null = null;
  for (const a of areas) if (rectContains(a.rect, px, py)) found = a;
  if (!found) return { active: false, areaId: null, areaRect: null };
  return { active: true, areaId: found.id, areaRect: found.rect };
}

/**
 * The rectangles covering the whole map MINUS the focus rect — the region to
 * darken. Returns up to four bands (top / bottom / left / right of the hole),
 * each clamped to the map bounds; degenerate (zero-area) bands are dropped, so
 * an area flush against a map edge simply yields fewer bands.
 */
export function dimBands(
  area: Rect,
  mapWidth: number,
  mapHeight: number
): Rect[] {
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(v, hi));
  const rx0 = clamp(area.x, mapWidth);
  const ry0 = clamp(area.y, mapHeight);
  const rx1 = clamp(area.x + area.width, mapWidth);
  const ry1 = clamp(area.y + area.height, mapHeight);
  const bands: Rect[] = [
    { x: 0, y: 0, width: mapWidth, height: ry0 }, // top
    { x: 0, y: ry1, width: mapWidth, height: mapHeight - ry1 }, // bottom
    { x: 0, y: ry0, width: rx0, height: ry1 - ry0 }, // left
    { x: rx1, y: ry0, width: mapWidth - rx1, height: ry1 - ry0 }, // right
  ];
  return bands.filter((b) => b.width > 0 && b.height > 0);
}

/**
 * Collapse the dim's containing-area id (a room id like "1", or "stage" /
 * "arcade") onto the named building-area id it belongs to (rooms 1-3 ⇒
 * "mandakini", 4-6 ⇒ "cauvery"; "stage"/"arcade" pass through). Returns null
 * outdoors or for any id that maps to no named area. This is the single bridge
 * from the dim's per-room containment to the coarser AREA_NAMES grouping — the
 * floor-painted names key off the SAME containment the dim already computed,
 * never a second geometry test.
 */
export function focusAreaId(dimAreaId: string | null): string | null {
  if (dimAreaId === null) return null;
  const roomArea = areaIdForRoom(dimAreaId);
  if (roomArea) return roomArea;
  return AREA_NAMES.some((a) => a.id === dimAreaId) ? dimAreaId : null;
}

/**
 * Whether a floor-painted area name is currently hidden (faded out): exactly
 * when the player stands inside that same named area. `focusId` is the result of
 * `focusAreaId` for the player's current containing area. WorldScene tweens each
 * floor label's alpha toward `hidden ? 0 : 1` on every area change.
 */
export function floorNameHidden(
  floorAreaId: string,
  focusId: string | null
): boolean {
  return floorAreaId === focusId;
}

/**
 * A neutral grey (0xRRGGBB) that, drawn as a full-strength MULTIPLY overlay,
 * scales the scene beneath to `brightness` (0..1). WorldScene fades the overlay's
 * alpha between 0 and 1 to cross-fade the dim without recomputing the colour.
 */
export function dimTintColor(brightness: number): number {
  const c = Math.max(0, Math.min(Math.round(brightness * 255), 255));
  return (c << 16) | (c << 8) | c;
}
