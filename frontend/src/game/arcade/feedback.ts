/**
 * Run-feedback predicates for the arcade games — pure, no DOM/Phaser/net.
 *
 * These decide WHICH feedback beat has just happened (a near miss); the
 * renderers only act on the answer. They are
 * READ-ONLY views over existing state: nothing here changes a rule or is
 * consulted by a reducer, which is also why they live in their own module —
 * Flappy's rule module stays byte-for-byte untouched by issue #163.
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

/** Pixels of near-miss clearance below which Flappy counts as "that was close". */
export const FLAPPY_NEAR_MISS_PX = 10;

/**
 * Smallest gap-edge clearance while the bird horizontally overlaps a pipe, or
 * null when the bird is between pipes. Negative values mean the bird is inside
 * the pipe body (i.e. it just died).
 */
export function flappyGapClearance(state: FlappyState): number | null {
  const left = state.birdX - state.birdRadius;
  const right = state.birdX + state.birdRadius;
  const top = state.birdY - state.birdRadius;
  const bottom = state.birdY + state.birdRadius;
  let closest: number | null = null;
  for (const pipe of state.pipes) {
    if (right < pipe.x || left > pipe.x + state.pipeWidth) continue;
    const clearance = Math.min(top - pipe.gapY, pipe.gapY + state.pipeGap - bottom);
    if (closest === null || clearance < closest) closest = clearance;
  }
  return closest;
}

/** True while the living bird is squeezing through a pipe gap with little room. */
export function flappyNearMiss(state: FlappyState, threshold = FLAPPY_NEAR_MISS_PX): boolean {
  if (!state.alive) return false;
  const clearance = flappyGapClearance(state);
  return clearance !== null && clearance >= 0 && clearance < threshold;
}
