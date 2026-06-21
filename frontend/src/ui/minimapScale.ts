export const MINIMAP_MAX_W = 184;
export const MINIMAP_MAX_H = 132;

/** Uniform scale that fits a world into the minimap box, preserving aspect. */
export function fitScale(
  worldW: number,
  worldH: number,
  maxW = MINIMAP_MAX_W,
  maxH = MINIMAP_MAX_H
): number {
  if (worldW <= 0 || worldH <= 0) return 1;
  return Math.min(maxW / worldW, maxH / worldH);
}
