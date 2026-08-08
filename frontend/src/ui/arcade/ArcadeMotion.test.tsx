import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { initReducedMotion } from "../reducedMotionBridge";
import { setSettings } from "../settings";
import MergeDropGame from "./MergeDropGame";
import { initFlappy } from "../../game/arcade/flappy";
import { createFx } from "./flappy/fx";
import { renderFlappy } from "./flappy/render";

function canvasContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: vi.fn() };
  return new Proxy(
    {
      createLinearGradient: vi.fn(() => gradient),
      createRadialGradient: vi.fn(() => gradient),
      translate: vi.fn(),
    },
    {
      get(target, key) {
        if (key in target) return target[key as keyof typeof target];
        return vi.fn();
      },
      set(target, key, value) {
        Object.assign(target, { [key]: value });
        return true;
      },
    }
  ) as unknown as CanvasRenderingContext2D;
}

describe("arcade canvas reduced motion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSettings({ reducedMotion: "off" });
    initReducedMotion();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("suppresses Flappy's renderer shake when the live preference is off", () => {
    const ctx = canvasContext();
    const translate = ctx.translate as ReturnType<typeof vi.fn>;
    const fx = createFx();
    fx.shake = 12;

    renderFlappy(ctx, initFlappy(1), fx, [], 1, false);
    expect(translate).toHaveBeenCalledWith(0, 0);

    translate.mockClear();
    renderFlappy(ctx, initFlappy(1), fx, [], 1, true);
    expect(translate.mock.calls[0]).not.toEqual([0, 0]);
  });

  it("suppresses MergeDrop canvas shake live when the shake prop turns off", () => {
    const ctx = canvasContext();
    const setTransform = vi.fn();
    (ctx as unknown as { setTransform: typeof setTransform }).setTransform = setTransform;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);

    const { rerender } = render(
      <MergeDropGame
        seed={1}
        paused={false}
        shake={true}
        onScore={vi.fn()}
        onGameOver={vi.fn()}
      />
    );

    // Seed residual shake energy via a merge-like pulse: advance a few ticks
    // with the preference on, then flip it off — the live effect must zero the
    // offset on the next paint without remounting the cabinet.
    act(() => {
      vi.advanceTimersByTime(32);
    });
    setTransform.mockClear();

    rerender(
      <MergeDropGame
        seed={1}
        paused={false}
        shake={false}
        onScore={vi.fn()}
        onGameOver={vi.fn()}
      />
    );
    act(() => {
      vi.advanceTimersByTime(16);
    });

    // Every paint after the toggle must use a zero translation offset.
    // setTransform(S, 0, 0, S, ox*S, oy*S) — ox/oy must be 0.
    for (const call of setTransform.mock.calls) {
      expect(call[4]).toBe(0);
      expect(call[5]).toBe(0);
    }
    expect(setTransform).toHaveBeenCalled();
  });

  it("suppresses MergeDrop canvas shake live when reduced motion turns on", () => {
    const ctx = canvasContext();
    const setTransform = vi.fn();
    (ctx as unknown as { setTransform: typeof setTransform }).setTransform = setTransform;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);

    render(
      <MergeDropGame
        seed={1}
        paused={false}
        shake={true}
        onScore={vi.fn()}
        onGameOver={vi.fn()}
      />
    );
    act(() => {
      vi.advanceTimersByTime(32);
    });
    setTransform.mockClear();

    act(() => {
      setSettings({ reducedMotion: "on" });
    });
    act(() => {
      vi.advanceTimersByTime(16);
    });

    for (const call of setTransform.mock.calls) {
      expect(call[4]).toBe(0);
      expect(call[5]).toBe(0);
    }
    expect(setTransform).toHaveBeenCalled();
  });
});
