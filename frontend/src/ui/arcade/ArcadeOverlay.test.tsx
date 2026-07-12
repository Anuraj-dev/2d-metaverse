import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ArcadeLeaderboard } from "@metaverse/shared";

const net = vi.hoisted(() => ({
  fetchLeaderboard: vi.fn(),
  submitScore: vi.fn(),
}));
vi.mock("../../net/arcade", () => net);

import ArcadeOverlay from "./ArcadeOverlay";
import { getSettings, setSettings } from "../settings";

const board: ArcadeLeaderboard = {
  game: "snake",
  top: [{ username: "ada", score: 42 }],
  best: 17,
};

beforeEach(() => {
  net.fetchLeaderboard.mockResolvedValue(board);
  net.submitScore.mockResolvedValue(board);
  // jsdom has no canvas backend; renderers guard a null context.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("ArcadeOverlay", () => {
  it("renders the leaderboard best + top-N once loaded", async () => {
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    expect(await screen.findByText(/Your best: 17/)).toBeTruthy();
    expect(screen.getByText("ada")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("Escape closes the overlay instantly", () => {
    const onClose = vi.fn();
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Regression for the known focus trap: a lingering focused input (e.g. the
  // chat field) must not keep keyboard focus once the arcade opens,
  // or it would swallow the game's keys via the scene's isTyping guard.
  it("takes keyboard focus away from a stale focused input on open", () => {
    const stale = document.createElement("input");
    document.body.appendChild(stale);
    stale.focus();
    expect(document.activeElement).toBe(stale);

    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    expect(document.activeElement).not.toBe(stale);

    stale.remove();
  });

  it("toggles the arcade mute through the shared settings store", () => {
    setSettings({ muteArcade: false });
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    const muteBtn = screen.getByLabelText("Mute arcade sound");
    fireEvent.click(muteBtn);
    expect(getSettings().muteArcade).toBe(true);
    // The button flips to the unmute affordance once muted.
    expect(screen.getByLabelText("Unmute arcade sound")).toBeTruthy();
  });

  it("writes the arcade volume slider into settings (and unmutes)", () => {
    setSettings({ arcadeVolume: 0.5, muteArcade: true });
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={() => {}} />);
    const slider = screen.getByLabelText("Arcade volume");
    fireEvent.change(slider, { target: { value: "20" } });
    expect(getSettings().arcadeVolume).toBeCloseTo(0.2);
    expect(getSettings().muteArcade).toBe(false);
  });

  it("requests fullscreen on open and exits it on close", () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn().mockResolvedValue(undefined);
    // jsdom lacks the Fullscreen API — stub the minimum the overlay touches.
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: request,
    });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });

    const onClose = vi.fn();
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={onClose} />);
    expect(request).toHaveBeenCalledTimes(1);

    // Pretend the browser granted it, then close via Escape → exitFullscreen runs.
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => document.querySelector(".arcade-backdrop"),
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalled();

    Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
    Reflect.deleteProperty(document, "exitFullscreen");
    Reflect.deleteProperty(document, "fullscreenElement");
  });

  it("submits the score and shows Game over when a run ends", async () => {
    vi.useFakeTimers();
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    // Snake starts heading right; advancing enough ticks walks it into the wall.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText("Game over")).toBeTruthy();
    expect(net.submitScore).toHaveBeenCalledWith("snake", expect.any(Number));
  });
});
