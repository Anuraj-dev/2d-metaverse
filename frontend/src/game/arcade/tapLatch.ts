/**
 * Edge-triggered tap latch for the merge-drop aim keys (review round 1, P2).
 *
 * The renderer samples input once per 16ms tick, so a quick arrow-key tap can
 * begin and end anywhere relative to a tick boundary. The contract this
 * module enforces, regardless of that phase:
 *
 * - Every press moves the aim for at least TAP_TICKS ticks in total. Ticks
 *   already sampled while the key was physically held count toward that
 *   minimum; only the unsampled remainder is owed after release. (The old
 *   single-latch version zeroed the latch on the first held sample, so a tap
 *   spanning a boundary got 1 tick instead of TAP_TICKS.)
 * - Released presses queue FIFO instead of overwriting each other, so rapid
 *   alternating taps each deliver their nudge in order.
 * - Physically held keys always win: while any aim key is down the queue is
 *   paused, and holding both directions moves nothing (the held state's zero
 *   axis is respected — no stale latch drifts through it).
 * - A press released while the opposite key is still held is discarded, not
 *   queued: the player is steering with the held key, and replaying the tap
 *   seconds later would be a surprise nudge.
 *
 * Pure module by convention: plain values in/out, no DOM/timers. The renderer
 * feeds it key events and calls `sampleTap` once per tick.
 */

/** Ticks of aim travel guaranteed to a single tap. */
export const TAP_TICKS = 9;

/** Released presses still owed movement never pile past this depth. */
export const TAP_QUEUE_MAX = 4;

/** A released press with movement still owed. */
export interface TapPress {
  readonly dir: -1 | 1;
  readonly remaining: number;
}

export interface TapLatchState {
  /** Physically-held aim keys. */
  readonly left: boolean;
  readonly right: boolean;
  /** Minimum-nudge ticks still owed to the live left/right press. */
  readonly owedLeft: number;
  readonly owedRight: number;
  /** Released presses still owed movement, oldest first. */
  readonly queue: readonly TapPress[];
}

export const IDLE_TAP_LATCH: TapLatchState = {
  left: false,
  right: false,
  owedLeft: 0,
  owedRight: 0,
  queue: [],
};

/** Key press edge. OS auto-repeat (a keydown while already held) is a no-op. */
export function tapKeyDown(state: TapLatchState, dir: -1 | 1): TapLatchState {
  if (dir === -1) {
    if (state.left) return state;
    return { ...state, left: true, owedLeft: TAP_TICKS };
  }
  if (state.right) return state;
  return { ...state, right: true, owedRight: TAP_TICKS };
}

/** Key release edge: bank the unsampled remainder of the press's minimum nudge. */
export function tapKeyUp(state: TapLatchState, dir: -1 | 1): TapLatchState {
  const otherHeld = dir === -1 ? state.right : state.left;
  const owed = dir === -1 ? state.owedLeft : state.owedRight;
  let queue = state.queue;
  if (!otherHeld && owed > 0) {
    // FIFO, capped: drop the oldest nudge rather than growing unbounded.
    queue = [...queue, { dir, remaining: owed }];
    if (queue.length > TAP_QUEUE_MAX) queue = queue.slice(queue.length - TAP_QUEUE_MAX);
  }
  return dir === -1
    ? { ...state, left: false, owedLeft: 0, queue }
    : { ...state, right: false, owedRight: 0, queue };
}

/** Focus loss: forget everything — nothing may keep drifting. */
export function tapBlur(): TapLatchState {
  return IDLE_TAP_LATCH;
}

/**
 * One per-tick sample: the movement to feed the reducer, plus the next state.
 * Held keys are served first (their zero included); the queue only plays when
 * no aim key is physically held.
 */
export function sampleTap(state: TapLatchState): { move: -1 | 0 | 1; state: TapLatchState } {
  if (state.left || state.right) {
    if (state.left === state.right) return { move: 0, state }; // both held: dead axis
    if (state.left) {
      const owedLeft = state.owedLeft > 0 ? state.owedLeft - 1 : 0;
      return { move: -1, state: owedLeft === state.owedLeft ? state : { ...state, owedLeft } };
    }
    const owedRight = state.owedRight > 0 ? state.owedRight - 1 : 0;
    return { move: 1, state: owedRight === state.owedRight ? state : { ...state, owedRight } };
  }
  const head = state.queue[0];
  if (!head) return { move: 0, state };
  const rest = state.queue.slice(1);
  const queue = head.remaining > 1 ? [{ dir: head.dir, remaining: head.remaining - 1 }, ...rest] : rest;
  return { move: head.dir, state: { ...state, queue } };
}
