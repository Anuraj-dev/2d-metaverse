import { describe, it, expect } from "vitest";
import {
  IDLE_TAP_LATCH,
  TAP_QUEUE_MAX,
  TAP_TICKS,
  sampleTap,
  tapBlur,
  tapKeyDown,
  tapKeyUp,
  type TapLatchState,
} from "./tapLatch";

/** Run `n` samples, returning the moves emitted and the final state. */
function samples(state: TapLatchState, n: number): { moves: number[]; state: TapLatchState } {
  const moves: number[] = [];
  let s = state;
  for (let i = 0; i < n; i++) {
    const out = sampleTap(s);
    moves.push(out.move);
    s = out.state;
  }
  return { moves, state: s };
}

describe("tapLatch", () => {
  it("emits nothing while idle", () => {
    expect(samples(IDLE_TAP_LATCH, 5).moves).toEqual([0, 0, 0, 0, 0]);
  });

  it("grants a sub-tick tap the full minimum nudge", () => {
    // Press and release entirely between two samples.
    const s = tapKeyUp(tapKeyDown(IDLE_TAP_LATCH, -1), -1);
    const { moves } = samples(s, TAP_TICKS + 3);
    expect(moves).toEqual([...Array<number>(TAP_TICKS).fill(-1), 0, 0, 0]);
  });

  it("counts held samples toward the minimum — total is TAP_TICKS at every phase offset", () => {
    // The round-1 bug: a tap crossing a tick boundary got 1 tick instead of 9.
    for (const heldTicks of [0, 1, 2, 5, TAP_TICKS - 1]) {
      let s = tapKeyDown(IDLE_TAP_LATCH, 1);
      const before = samples(s, heldTicks);
      s = tapKeyUp(before.state, 1);
      const after = samples(s, TAP_TICKS + 2);
      const total = [...before.moves, ...after.moves].filter((m) => m === 1).length;
      expect(total).toBe(TAP_TICKS);
      // And nothing keeps moving once the nudge is spent.
      expect(after.moves.slice(TAP_TICKS - heldTicks)).toEqual(
        Array<number>(heldTicks + 2).fill(0)
      );
    }
  });

  it("gives a long hold exactly its held ticks — no post-release drift", () => {
    let s = tapKeyDown(IDLE_TAP_LATCH, -1);
    const held = samples(s, TAP_TICKS + 6);
    expect(held.moves).toEqual(Array<number>(TAP_TICKS + 6).fill(-1));
    s = tapKeyUp(held.state, -1);
    expect(samples(s, 4).moves).toEqual([0, 0, 0, 0]);
  });

  it("queues rapid alternating taps FIFO instead of overwriting", () => {
    // The round-1 bug: the single latch let the second tap erase the first.
    let s = IDLE_TAP_LATCH;
    s = tapKeyUp(tapKeyDown(s, -1), -1);
    s = tapKeyUp(tapKeyDown(s, 1), 1);
    const { moves } = samples(s, TAP_TICKS * 2 + 2);
    expect(moves).toEqual([
      ...Array<number>(TAP_TICKS).fill(-1),
      ...Array<number>(TAP_TICKS).fill(1),
      0,
      0,
    ]);
  });

  it("moves nothing while both directions are held — held keys win, zero included", () => {
    // The round-1 bug: axis() was 0 but the stale latch kept moving the aim.
    let s = tapKeyDown(IDLE_TAP_LATCH, -1);
    s = tapKeyDown(s, 1);
    expect(samples(s, 6).moves).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("discards a tap released under an opposite hold instead of replaying it later", () => {
    // Hold right, tap left mid-hold: the tap must not fire seconds later.
    let s = tapKeyDown(IDLE_TAP_LATCH, 1);
    s = samples(s, 3).state;
    s = tapKeyDown(s, -1); // both held now
    const during = samples(s, 2);
    expect(during.moves).toEqual([0, 0]);
    s = tapKeyUp(during.state, -1); // left released while right still held
    const resumed = samples(s, 3);
    expect(resumed.moves).toEqual([1, 1, 1]);
    s = tapKeyUp(resumed.state, 1);
    // Right's own minimum was already sampled past; left was discarded.
    const after = samples(s, TAP_TICKS);
    expect(after.moves.every((m) => m !== -1)).toBe(true);
  });

  it("still owes the held key's remainder after an interrupting opposite tap", () => {
    // Tap right (crosses one tick), left interrupts nothing here: right's
    // remainder queues on release with no other key held.
    let s = tapKeyDown(IDLE_TAP_LATCH, 1);
    s = samples(s, 2).state;
    s = tapKeyUp(s, 1);
    const { moves } = samples(s, TAP_TICKS);
    expect(moves.filter((m) => m === 1)).toHaveLength(TAP_TICKS - 2);
  });

  it("ignores OS auto-repeat keydowns — the minimum is per press, not per repeat", () => {
    let s = tapKeyDown(IDLE_TAP_LATCH, -1);
    s = samples(s, TAP_TICKS).state; // minimum fully sampled while held
    s = tapKeyDown(s, -1); // auto-repeat must not re-arm the owed ticks
    s = tapKeyUp(s, -1);
    expect(samples(s, 4).moves).toEqual([0, 0, 0, 0]);
  });

  it("caps the queue at TAP_QUEUE_MAX, dropping the oldest", () => {
    let s = IDLE_TAP_LATCH;
    for (let i = 0; i < TAP_QUEUE_MAX + 2; i++) {
      const dir = i % 2 === 0 ? -1 : 1;
      s = tapKeyUp(tapKeyDown(s, dir), dir);
    }
    expect(s.queue.length).toBe(TAP_QUEUE_MAX);
    // Oldest were dropped: the surviving head is press #3 (index 2).
    expect(s.queue[0]?.dir).toBe(-1);
    const { moves } = samples(s, TAP_QUEUE_MAX * TAP_TICKS + 1);
    expect(moves.filter((m) => m !== 0)).toHaveLength(TAP_QUEUE_MAX * TAP_TICKS);
  });

  it("forgets everything on blur", () => {
    const s = tapKeyUp(tapKeyDown(tapKeyDown(IDLE_TAP_LATCH, -1), 1), 1);
    expect(s).not.toEqual(IDLE_TAP_LATCH);
    const cleared = tapBlur();
    expect(cleared).toEqual(IDLE_TAP_LATCH);
    expect(samples(cleared, 3).moves).toEqual([0, 0, 0]);
  });

  it("never mutates its inputs", () => {
    const s0 = tapKeyUp(tapKeyDown(IDLE_TAP_LATCH, -1), -1);
    const frozen = JSON.stringify(s0);
    sampleTap(s0);
    tapKeyDown(s0, 1);
    tapKeyUp(s0, -1);
    expect(JSON.stringify(s0)).toBe(frozen);
  });
});
