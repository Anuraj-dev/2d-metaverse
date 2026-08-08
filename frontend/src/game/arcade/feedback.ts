/**
 * Run-feedback predicates for the arcade games — pure, no DOM/Phaser/net.
 *
 * These decide WHICH feedback beat has just happened (a near miss); the
 * renderer only acts on the answer. It is a READ-ONLY view over existing
 * state: nothing here changes a rule or is consulted by a reducer. Flappy's
 * renderer owns its richer pipe/impact feedback beside its draw code.
 */
import type { FlappyState } from "./flappy";

/** World-unit clearance below which a living bird counts as a near miss. */
export const FLAPPY_NEAR_MISS_PX = 10;

/**
 * Smallest gap-edge clearance while the bird overlaps a pipe horizontally, or
 * null between pipes. Negative means the bird is already inside pipe geometry.
 */
export function flappyGapClearance(state: FlappyState): number | null {
  const left = state.birdX - state.birdRadius;
  const right = state.birdX + state.birdRadius;
  const top = state.birdY - state.birdRadius;
  const bottom = state.birdY + state.birdRadius;
  let closest: number | null = null;
  for (const pipe of state.pipes) {
    if (right < pipe.x || left > pipe.x + state.pipeWidth) continue;
    const clearance = Math.min(top - pipe.top, pipe.top + pipe.gap - bottom);
    if (closest === null || clearance < closest) closest = clearance;
  }
  return closest;
}

/** True only while the living bird safely squeezes close to a gap edge. */
export function flappyNearMiss(state: FlappyState, threshold = FLAPPY_NEAR_MISS_PX): boolean {
  if (state.phase !== "play") return false;
  const clearance = flappyGapClearance(state);
  return clearance !== null && clearance >= 0 && clearance < threshold;
}
