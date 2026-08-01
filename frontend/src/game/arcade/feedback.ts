/**
 * Run-feedback predicates for the arcade games — pure, no DOM/Phaser/net.
 *
 * These decide WHICH feedback beat has just happened (a near miss); the
 * renderer only acts on the answer. It is a READ-ONLY view over existing
 * state: nothing here changes a rule or is consulted by a reducer. Flappy's
 * current renderer owns its richer pipe/impact feedback beside its draw code.
 */
import { isBlockedCell, type SnakeState } from "./snake";
import type { FlappyState } from "./flappy";

/**
 * How many of the head's forward/side neighbours are lethal right now — a wall,
 * the board edge, or a body segment that will still be there next tick (the tail
 * vacates, so it does not count). The cell behind the head (the neck) is
 * excluded: it is always occupied and can never be steered into anyway.
 *
 * Range 0..3. Returns 0 for a terminal state.
 */
export function snakeHeadPressure(state: SnakeState): number {
  if (!state.alive || state.won) return 0;
  const head = state.body[0];
  const neck = state.body[1];
  if (!head) return 0;
  // Everything except the tail: the tail cell is vacated on the next tick.
  const solidBody = state.body.slice(0, -1);
  const neighbours = [
    { x: head.x + 1, y: head.y },
    { x: head.x - 1, y: head.y },
    { x: head.x, y: head.y + 1 },
    { x: head.x, y: head.y - 1 },
  ];
  let pressure = 0;
  for (const n of neighbours) {
    if (neck && n.x === neck.x && n.y === neck.y) continue;
    if (isBlockedCell(state, n) || solidBody.some((c) => c.x === n.x && c.y === n.y)) {
      pressure++;
    }
  }
  return pressure;
}

/**
 * A near miss is surviving a tick with at least two of the three steerable
 * neighbours lethal — i.e. the snake threaded a gap rather than crossed open
 * floor.
 */
export function snakeNearMiss(state: SnakeState): boolean {
  return snakeHeadPressure(state) >= 2;
}

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
