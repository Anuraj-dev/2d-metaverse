import { previewSnakeDir, type Cell, type Dir } from "../../../game/arcade/snake";

export function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Each cell glide must finish well before the next tick: stretching it across
 * the whole interval leaves the on-screen snake a full tick behind the
 * committed state, which reads as input latency (deadly near walls).
 */
export const GLIDE_MS = 60;

/**
 * Heading for the head/eyes: use the pure reducer's queued-turn preview so the
 * face answers a keypress on the very next frame without duplicating rule logic.
 */
export function renderHeading(dir: Dir, dirQueue: readonly Dir[]): Dir {
  return previewSnakeDir(dir, dirQueue);
}

/**
 * A single reducer tick shifts every prior segment one index toward the tail.
 * Checking the whole overlap distinguishes it from a multi-tick catch-up frame
 * without adding scheduling data to the locked reducer contract.
 */
export function isSingleTickBodyTransition(
  previous: readonly Cell[],
  current: readonly Cell[]
): boolean {
  if (
    previous.length === 0 ||
    current.length < 2 ||
    (current.length !== previous.length && current.length !== previous.length + 1)
  ) {
    return false;
  }

  for (let index = 0; index < current.length - 1; index += 1) {
    const before = previous[index];
    const after = current[index + 1];
    if (!before || !after || before.x !== after.x || before.y !== after.y) return false;
  }
  return true;
}

/**
 * Pair segments by head-first index and interpolate in grid coordinates. A new
 * growth tail has no prior index partner, so it draws at its final cell instead
 * of stretching in from an unrelated segment.
 */
export function interpolateSnakeBody(
  previous: readonly Cell[],
  current: readonly Cell[],
  alpha: number,
  snap: boolean
): readonly Cell[] {
  if (snap || previous.length === 0) return current;
  const t = clampUnit(alpha);
  return current.map((cell, index) => {
    const before = previous[index];
    if (!before) return cell;
    return {
      x: before.x + (cell.x - before.x) * t,
      y: before.y + (cell.y - before.y) * t,
    };
  });
}
