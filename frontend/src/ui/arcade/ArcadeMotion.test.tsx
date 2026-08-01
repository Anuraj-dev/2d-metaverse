import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { initReducedMotion } from "../reducedMotionBridge";
import { setSettings } from "../settings";
import SnakeGame from "./SnakeGame";
import { initFlappy } from "../../game/arcade/flappy";
import { createFx } from "./flappy/fx";
import { renderFlappy } from "./flappy/render";

const { shakeOffset } = vi.hoisted(() => ({
  shakeOffset: vi.fn(() => ({ x: 5, y: 5 })),
}));

vi.mock("../../game/arcade/juice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../game/arcade/juice")>();
  return { ...actual, shakeOffset };
});

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
    shakeOffset.mockClear();
    setSettings({ reducedMotion: "off" });
    initReducedMotion();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stops Snake shake during an active run when reduced motion turns on", () => {
      const ctx = canvasContext();
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);

      render(
        <SnakeGame
          seed={1}
          paused={false}
          shake={true}
          onScore={vi.fn()}
          onGameOver={vi.fn()}
        />
      );
      expect(shakeOffset).toHaveBeenCalled();
      shakeOffset.mockClear();

      act(() => {
        setSettings({ reducedMotion: "on" });
      });
      act(() => {
        vi.advanceTimersByTime(16);
      });

      expect(shakeOffset).not.toHaveBeenCalled();
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
});
