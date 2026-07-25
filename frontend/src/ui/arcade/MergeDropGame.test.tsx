import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

// Wrap the reducer so each tick's sampled input is observable — the tap-latch
// contract is "which `move` reaches the reducer on which tick", which no DOM
// or canvas output exposes directly.
vi.mock("../../game/arcade/mergedrop", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../game/arcade/mergedrop")>();
  return { ...mod, stepMergeDrop: vi.fn(mod.stepMergeDrop) };
});

import MergeDropGame from "./MergeDropGame";
import { stepMergeDrop } from "../../game/arcade/mergedrop";
import { TAP_TICKS } from "../../game/arcade/tapLatch";

const TICK_MS = 16;
const stepSpy = vi.mocked(stepMergeDrop);

/** Advance n reducer ticks on fake timers — never real time. */
function ticks(n: number): void {
  act(() => {
    vi.advanceTimersByTime(TICK_MS * n);
  });
}

/** The `move` handed to the reducer on each tick since call index `start`. */
function movesSince(start: number): number[] {
  return stepSpy.mock.calls.slice(start).map((call) => {
    const input = call[1];
    if (!input) throw new Error("stepMergeDrop was called without an input");
    return input.move;
  });
}

function mount(): void {
  render(<MergeDropGame seed={1} paused={false} onScore={() => {}} onGameOver={() => {}} />);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("MergeDropGame tap sampling", () => {
  beforeEach(() => {
    // jsdom has no canvas backend; the renderer guards a null context.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  it("delivers the full minimum nudge at every sampler phase offset", () => {
    // Round-1 P2: a tap crossing a tick boundary got 1 movement tick instead
    // of TAP_TICKS. Held ticks must count toward the minimum, the remainder
    // must survive the release.
    mount();
    for (const heldTicks of [0, 1, 4]) {
      const start = stepSpy.mock.calls.length;
      fireEvent.keyDown(window, { key: "ArrowRight" });
      ticks(heldTicks);
      fireEvent.keyUp(window, { key: "ArrowRight" });
      ticks(TAP_TICKS + 2);
      const moves = movesSince(start);
      expect(moves.filter((m) => m === 1)).toHaveLength(TAP_TICKS);
      // Spent exactly: the trailing ticks sample no movement.
      expect(moves.slice(TAP_TICKS)).toEqual(Array<number>(moves.length - TAP_TICKS).fill(0));
    }
  });

  it("queues rapid alternating taps FIFO — the second never erases the first", () => {
    mount();
    const start = stepSpy.mock.calls.length;
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyUp(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyUp(window, { key: "ArrowRight" });
    ticks(TAP_TICKS * 2 + 2);
    expect(movesSince(start)).toEqual([
      ...Array<number>(TAP_TICKS).fill(-1),
      ...Array<number>(TAP_TICKS).fill(1),
      0,
      0,
    ]);
  });

  it("holding both directions moves nothing, and an interrupting tap is not replayed", () => {
    mount();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    ticks(3);
    const bothStart = stepSpy.mock.calls.length;
    fireEvent.keyDown(window, { key: "ArrowLeft" }); // both held: dead axis
    ticks(2);
    expect(movesSince(bothStart)).toEqual([0, 0]);
    fireEvent.keyUp(window, { key: "ArrowLeft" }); // released under the right hold
    const resumeStart = stepSpy.mock.calls.length;
    ticks(2);
    expect(movesSince(resumeStart)).toEqual([1, 1]); // the held key resumes
    fireEvent.keyUp(window, { key: "ArrowRight" });
    const afterStart = stepSpy.mock.calls.length;
    ticks(TAP_TICKS + 2);
    // The discarded left tap must never fire late.
    expect(movesSince(afterStart).every((m) => m !== -1)).toBe(true);
  });

  it("releasing an alias key does not release a direction still physically held", () => {
    // Round-2 P2: ArrowLeft and A collapsed into one boolean, so releasing A
    // while ArrowLeft was still down marked the direction released (and could
    // bank a spurious tap remainder). Hold ArrowLeft, tap A mid-hold: the
    // direction must keep moving without interruption, and the press's
    // remainder must bank only when the LAST alias comes up.
    mount();
    const start = stepSpy.mock.calls.length;
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    ticks(3);
    fireEvent.keyDown(window, { key: "a" }); // alias joins the same hold
    ticks(2);
    fireEvent.keyUp(window, { key: "a" }); // alias leaves — ArrowLeft still down
    ticks(2);
    expect(movesSince(start)).toEqual(Array<number>(7).fill(-1));
    fireEvent.keyUp(window, { key: "ArrowLeft" }); // LAST alias up: release edge
    ticks(TAP_TICKS);
    // 7 held ticks + the banked 2-tick remainder = the TAP_TICKS minimum, then rest.
    expect(movesSince(start)).toEqual([
      ...Array<number>(TAP_TICKS).fill(-1),
      ...Array<number>(7).fill(0),
    ]);
  });

  it("blur clears held keys and queued nudges alike", () => {
    mount();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    ticks(2);
    fireEvent(window, new Event("blur"));
    const start = stepSpy.mock.calls.length;
    ticks(4);
    expect(movesSince(start)).toEqual([0, 0, 0, 0]);
  });
});

describe("MergeDropGame draw caching", () => {
  it("creates no canvas gradients in a steady-state frame once caches are warm", () => {
    // Round-1 P1: the renderer rebuilt ~14 baseline + 2-per-body gradients
    // every frame. Static layers are now baked, so a quiet frame (no merges,
    // no new tiers) must create zero gradients.
    const gradientStub = (): CanvasGradient =>
      ({ addColorStop: () => {} }) as unknown as CanvasGradient;
    const createLinearGradient = vi.fn(gradientStub);
    const createRadialGradient = vi.fn(gradientStub);
    const noop = vi.fn();
    const raw = {
      createLinearGradient,
      createRadialGradient,
      setTransform: noop,
      save: noop,
      restore: noop,
      translate: noop,
      scale: noop,
      beginPath: noop,
      closePath: noop,
      arc: noop,
      ellipse: noop,
      rect: noop,
      roundRect: noop,
      fill: noop,
      stroke: noop,
      clip: noop,
      moveTo: noop,
      lineTo: noop,
      setLineDash: noop,
      fillRect: noop,
      strokeRect: noop,
      clearRect: noop,
      fillText: noop,
      drawImage: noop,
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      font: "",
      textAlign: "left",
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      raw as unknown as CanvasRenderingContext2D
    );

    mount();
    // Warm every cache the idle scene touches: background, held-body sprite,
    // ladder, NEXT preview. (Well below the tick-300 auto-drop.)
    ticks(20);
    createLinearGradient.mockClear();
    createRadialGradient.mockClear();
    ticks(1);
    expect(createLinearGradient).not.toHaveBeenCalled();
    expect(createRadialGradient).not.toHaveBeenCalled();
  });
});
