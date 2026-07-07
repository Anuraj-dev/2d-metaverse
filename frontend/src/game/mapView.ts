/**
 * Pure view-model for the fullscreen campus map (PRD 20). Plain values in / out —
 * no Phaser, DOM, or net. It resolves map-derived area rects to labeled anchors via
 * the shared AREA_NAMES registry, and hit-tests a click against live player dots for
 * the roster's camera-locate seam. The canvas component is a thin surface that draws
 * terrain/rooms/dots and calls these.
 */
import { AREA_NAMES } from "@metaverse/shared";

/** A map-derived rectangle for a named area (world-space pixels). */
export interface AreaRect {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface AreaLabel {
  readonly id: string;
  readonly name: string;
  /** Center of the area, where the label is drawn. */
  readonly cx: number;
  readonly cy: number;
}

export interface MapDot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** Resolve each area rect to a centered, named label; drop rects with no name. */
export function areaLabels(areas: readonly AreaRect[]): AreaLabel[] {
  return areas.flatMap((a) => {
    const name = AREA_NAMES.find((n) => n.id === a.id)?.name;
    return name
      ? [{ id: a.id, name, cx: a.x + a.w / 2, cy: a.y + a.h / 2 }]
      : [];
  });
}

/**
 * Id of the dot nearest a world-space point within `radius` (world units), or null
 * if none is in range. Ties resolve to the first-seen dot.
 */
export function nearestDot(
  dots: readonly MapDot[],
  x: number,
  y: number,
  radius: number,
): string | null {
  let best: string | null = null;
  let bestSq = radius * radius;
  for (const d of dots) {
    const dx = d.x - x;
    const dy = d.y - y;
    const sq = dx * dx + dy * dy;
    if (sq < bestSq) {
      bestSq = sq;
      best = d.id;
    }
  }
  return best;
}
