import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../game/arcade/breakout", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../game/arcade/breakout")>();
  return { ...mod, breakoutTick: vi.fn(mod.breakoutTick) };
});

import BreakoutGame from "./BreakoutGame";
import { breakoutTick } from "../../game/arcade/breakout";

const tickSpy = vi.mocked(breakoutTick);

function launchesSince(start: number): boolean[] {
  return tickSpy.mock.calls.slice(start).map((call) => {
    const input = call[1];
    if (!input) throw new Error("breakoutTick called without input");
    return input.launch;
  });
}

describe("BreakoutGame", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("exposes an accessible name covering mouse and keyboard serve", () => {
    render(
      <BreakoutGame
        seed={1}
        paused={false}
        shake={false}
        onScore={() => {}}
        onGameOver={() => {}}
      />,
    );
    expect(
      screen.getByRole("img", { name: /Breakout.*Space to serve/i }),
    ).toBeTruthy();
  });

  it("does not throw when serving from the keyboard while the canvas has no context", () => {
    render(
      <BreakoutGame
        seed={1}
        paused={false}
        shake={false}
        onScore={() => {}}
        onGameOver={() => {}}
      />,
    );
    expect(() => {
      fireEvent.keyDown(window, { key: " " });
      fireEvent.keyDown(window, { key: "ArrowLeft" });
    }).not.toThrow();
    expect(screen.getByRole("img", { name: /Breakout/i })).toBeTruthy();
  });

  it("serves on Space keydown only, never on keyup", () => {
    render(
      <BreakoutGame
        seed={1}
        paused={false}
        shake={false}
        onScore={() => {}}
        onGameOver={() => {}}
      />,
    );
    fireEvent.keyDown(window, { key: " " });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const afterDown = launchesSince(0).filter(Boolean).length;
    expect(afterDown).toBeGreaterThan(0);
    const start = tickSpy.mock.calls.length;
    fireEvent.keyUp(window, { key: " " });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(launchesSince(start).filter(Boolean)).toEqual([]);
  });
});
