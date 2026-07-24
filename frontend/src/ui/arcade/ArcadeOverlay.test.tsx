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
import { SNAKE_LEVELS, SNAKE_SPEEDS } from "../../game/arcade/snake";
import { bus } from "../../game/eventBus";

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

// ── Issue #163: options, shake toggle, instant restart, personal best ────────

describe("ArcadeOverlay — Snake options", () => {
  it("persists the speed choice through the shared settings store", () => {
    setSettings({ snakeSpeed: "normal" });
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Chill" }));
    expect(getSettings().snakeSpeed).toBe("chill");
    expect(screen.getByRole("button", { name: "Chill" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("persists the level choice and shows its hint", () => {
    setSettings({ snakeLevel: "open" });
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "The Vault" }));
    expect(getSettings().snakeLevel).toBe("vault");
    expect(screen.getByText(/four doors out/i)).toBeTruthy();
  });

  it("lists every shipped level and speed tier", () => {
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    const levels = screen.getByRole("group", { name: "Snake level" });
    // One button per level, plus none extra.
    expect(levels.querySelectorAll("button")).toHaveLength(SNAKE_LEVELS.length);
    expect(
      screen.getByRole("group", { name: "Snake speed" }).querySelectorAll("button"),
    ).toHaveLength(SNAKE_SPEEDS.length);
  });

  it("does not show Snake's options on another cabinet", () => {
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={() => {}} />);
    expect(screen.queryByRole("group", { name: "Snake level" })).toBeNull();
  });
});

describe("ArcadeOverlay — screen shake toggle", () => {
  it("writes the shake preference into the shared settings store", () => {
    setSettings({ arcadeShake: true });
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Turn screen shake off"));
    expect(getSettings().arcadeShake).toBe(false);
    // The control flips to the "turn it back on" affordance.
    expect(screen.getByLabelText("Turn screen shake on")).toBeTruthy();
  });
});

describe("ArcadeOverlay — end of run", () => {
  /**
   * A run that scores at least once, deterministically: with the system clock
   * pinned the overlay's seed is fixed, and this timestamp puts Snake's first
   * apple at (11,7) — three cells straight ahead of the Open Field start, so the
   * snake eats it before hitting the right wall. No input needed.
   */
  const SCORING_RUN_AT = 1767225600031;

  function runToGameOver(ms = 3000) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  /**
   * The leaderboard arrives on a promise, so the standing best is only known
   * after the microtask queue drains — flush it before the run ends, or every
   * run would look like a first-ever score.
   */
  async function flushLeaderboard() {
    await act(async () => {});
  }

  it("celebrates a personal best and emits the domain event for the mixer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(SCORING_RUN_AT);
    setSettings({ snakeLevel: "open", snakeSpeed: "normal" });
    net.fetchLeaderboard.mockResolvedValue({ game: "snake", top: [], best: 0 });
    const onBest = vi.fn();
    const off = bus.on("arcade-best", onBest);

    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    await flushLeaderboard();
    runToGameOver();

    expect(screen.getByText("Game over")).toBeTruthy();
    // Both the live scoreline and the game-over card show the scoring total.
    expect(screen.getAllByText(/Score [1-9]/).length).toBeGreaterThan(0);
    expect(screen.getByText("New personal best!")).toBeTruthy();
    expect(onBest).toHaveBeenCalledTimes(1);
    off();
  });

  it("does not celebrate a run that fails to beat the standing best", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(SCORING_RUN_AT);
    setSettings({ snakeLevel: "open", snakeSpeed: "normal" });
    // Default mock board.best is 17 — far above anything this short run scores.
    const onBest = vi.fn();
    const off = bus.on("arcade-best", onBest);

    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    await flushLeaderboard();
    runToGameOver();

    expect(screen.getByText("Game over")).toBeTruthy();
    expect(screen.queryByText("New personal best!")).toBeNull();
    expect(onBest).not.toHaveBeenCalled();
    off();
  });

  it("restarts instantly on a single key press", () => {
    vi.useFakeTimers();
    vi.setSystemTime(SCORING_RUN_AT);
    setSettings({ snakeLevel: "open", snakeSpeed: "normal" });
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    runToGameOver();
    expect(screen.getByText("Game over")).toBeTruthy();

    // A fresh seed needs a different clock reading than the finished run.
    vi.setSystemTime(SCORING_RUN_AT + 5000);
    act(() => {
      fireEvent.keyDown(window, { key: " " });
    });
    expect(screen.queryByText("Game over")).toBeNull();
    expect(screen.getByText("Score 0")).toBeTruthy();
  });

  it("ignores keys that are not restart keys while the card is up", () => {
    vi.useFakeTimers();
    vi.setSystemTime(SCORING_RUN_AT);
    setSettings({ snakeLevel: "open", snakeSpeed: "normal" });
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    runToGameOver();
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowLeft" });
    });
    expect(screen.getByText("Game over")).toBeTruthy();
  });
});
