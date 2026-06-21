/**
 * Spatial-audio falloff: volume scales linearly from 1 (touching) to 0 (at/after
 * the cutoff distance). Pure + framework-free so it is unit-testable.
 */
export function proximityVolume(distance: number, cutoff = 200): number {
  if (cutoff <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - distance / cutoff));
}
