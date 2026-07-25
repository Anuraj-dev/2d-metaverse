import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ArcadeLeaderboard, ArcadeScoreResult } from "@metaverse/shared";

const net = vi.hoisted(() => ({
  fetchLeaderboard: vi.fn(),
  submitScore: vi.fn(),
}));
vi.mock("../../net/arcade", () => net);

import ArcadeOverlay from "./ArcadeOverlay";
import { getSettings, setSettings } from "../settings";
import {
  initSnake,
  snakeLevelById,
  snakeSpeedById,
  snakeTick,
  SNAKE_LEVELS,
  SNAKE_SPEEDS,
} from "../../game/arcade/snake";
import { toSeed } from "../../game/arcade/prng";
import { bus } from "../../game/eventBus";

const board: ArcadeLeaderboard = {
  game: "snake",
  top: [{ username: "ada", score: 42 }],
  best: 17,
};
const scoreResult: ArcadeScoreResult = { ...board, newBest: false };

beforeEach(() => {
  net.fetchLeaderboard.mockResolvedValue(board);
  net.submitScore.mockResolvedValue(scoreResult);
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

  it("submits the score and shows Game over when a run ends", () => {
    vi.useFakeTimers();
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    // Snake starts heading right; advancing enough ticks walks it into the wall.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    // The score is submitted the moment the run ends, before the freeze elapses.
    expect(net.submitScore).toHaveBeenCalledWith("snake", expect.any(Number));
    // The card appears only after the death-freeze presentation.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByText("Game over")).toBeTruthy();
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
  /** A promise whose settlement the test controls explicitly. */
  function deferred<T>() {
    let resolve: (value: T) => void = () => {
      throw new Error("deferred resolve used before initialization");
    };
    let reject: (reason?: unknown) => void = () => {
      throw new Error("deferred reject used before initialization");
    };
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  /** How long endRun() advances, and the Normal-cadence ticks that buys. */
  const END_RUN_MS = 3000;
  const RUN_TICKS = Math.floor(END_RUN_MS / snakeSpeedById("normal").tickMs);

  /**
   * A clock reading whose no-input Snake run on Open Field scores EXACTLY
   * `target` and dies inside the endRun() window, found by simulating full runs
   * with the actual game module — the overlay seeds a run with
   * toSeed(Date.now() [+ prior run id on restarts]) — instead of a hard-coded
   * timestamp, so it survives PRNG or level changes. `seedOffset` matches the
   * overlay's restart mixing (the pre-increment run id) so a SECOND run can be
   * made deterministic too.
   */
  function scoringClock(seedOffset = 0, target = 1): number {
    const level = snakeLevelById("open");
    const base = 1_700_000_000_000;
    for (let t = base; t < base + 60_000; t++) {
      let s = initSnake(toSeed(t + seedOffset), level);
      for (let i = 0; i < RUN_TICKS && s.alive && !s.won; i++) s = snakeTick(s);
      if (!s.alive && s.score === target) return t;
    }
    throw new Error(`no clock scoring ${target} found in range`);
  }

  /** Advance far enough for the snake to hit the right wall (run terminal). */
  function endRun(ms = END_RUN_MS) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  /** Let the death-freeze presentation elapse so the game-over card appears. */
  function elapseFreeze() {
    act(() => {
      vi.advanceTimersByTime(500);
    });
  }

  it("celebrates only from the atomic score-submission verdict", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(scoringClock());
    setSettings({ snakeLevel: "open", snakeSpeed: "normal" });
    const lb = deferred<ArcadeLeaderboard>();
    const submit = deferred<ArcadeScoreResult>();
    net.fetchLeaderboard.mockReturnValue(lb.promise);
    net.submitScore.mockReturnValue(submit.promise);
    const onBest = vi.fn();
    const off = bus.on("arcade-best", onBest);

    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    endRun();
    elapseFreeze();
    await act(async () => {
      submit.resolve({
        game: "snake",
        top: [{ username: "me", score: 1 }],
        best: 1,
        newBest: true,
      });
    });

    expect(screen.getByText("New personal best!")).toBeTruthy();
    expect(onBest).toHaveBeenCalledTimes(1);

    // A slower pre-run GET cannot regress the newer submission result or
    // influence the already-authoritative verdict.
    await act(async () => {
      lb.resolve({ game: "snake", top: [], best: null });
    });
    expect(screen.getByText("Your best: 1")).toBeTruthy();
    expect(onBest).toHaveBeenCalledTimes(1);
    off();
  });

  it("does not celebrate when the atomic submission verdict is false", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(scoringClock());
    setSettings({ snakeLevel: "open", snakeSpeed: "normal" });
    const lb = deferred<ArcadeLeaderboard>();
    const submit = deferred<ArcadeScoreResult>();
    net.fetchLeaderboard.mockReturnValue(lb.promise);
    net.submitScore.mockReturnValue(submit.promise);
    const onBest = vi.fn();
    const off = bus.on("arcade-best", onBest);

    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    // Even a stale GET saying the user had no prior score cannot override the
    // write's atomic verdict.
    await act(async () => {
      lb.resolve({ game: "snake", top: [], best: null });
    });
    endRun();
    elapseFreeze();
    await act(async () => {
      submit.resolve({
        game: "snake",
        top: [{ username: "me", score: 1 }],
        best: 1,
        newBest: false,
      });
    });

    expect(screen.getByText("Game over")).toBeTruthy();
    expect(screen.queryByText("New personal best!")).toBeNull();
    expect(onBest).not.toHaveBeenCalled();
    off();
  });

  it("ignores an older run's celebration after restart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(scoringClock());
    setSettings({ snakeLevel: "open", snakeSpeed: "normal" });
    const lb = deferred<ArcadeLeaderboard>();
    const submit1 = deferred<ArcadeScoreResult>();
    const submit2 = deferred<ArcadeScoreResult>();
    net.fetchLeaderboard.mockReturnValue(lb.promise);
    net.submitScore.mockReturnValueOnce(submit1.promise).mockReturnValueOnce(submit2.promise);
    const onBest = vi.fn();
    const off = bus.on("arcade-best", onBest);

    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    endRun();
    elapseFreeze();

    vi.setSystemTime(scoringClock(1, 2));
    act(() => {
      fireEvent.keyDown(window, { key: " " });
    });
    endRun();
    elapseFreeze();

    // Run 1's true verdict is now stale for presentation: it may refresh the
    // aside but cannot decorate run 2's card.
    await act(async () => {
      submit1.resolve({
        game: "snake",
        top: [{ username: "me", score: 1 }],
        best: 1,
        newBest: true,
      });
    });
    expect(screen.queryByText("New personal best!")).toBeNull();
    expect(onBest).not.toHaveBeenCalled();

    // Run 2's own verdict is the only one allowed to celebrate its card.
    await act(async () => {
      submit2.resolve({
        game: "snake",
        top: [{ username: "me", score: 2 }],
        best: 2,
        newBest: true,
      });
    });
    expect(screen.getByText("New personal best!")).toBeTruthy();
    expect(onBest).toHaveBeenCalledTimes(1);
    off();
  });

  // RACE (round 2): responses landing after the overlay closed must be inert —
  // in particular no arcade-best emission on the global bus.
  it("late leaderboard responses after close never emit arcade-best", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(scoringClock());
    setSettings({ snakeLevel: "open", snakeSpeed: "normal" });
    const lb = deferred<ArcadeLeaderboard>();
    const submit = deferred<ArcadeScoreResult>();
    net.fetchLeaderboard.mockReturnValue(lb.promise);
    net.submitScore.mockReturnValue(submit.promise);
    const onBest = vi.fn();
    const off = bus.on("arcade-best", onBest);

    const { unmount } = render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    endRun(); // decision deferred: both requests still pending
    expect(net.submitScore).toHaveBeenCalledTimes(1);
    unmount();

    // Both responses settle with the arcade gone: no decision, no sound event.
    await act(async () => {
      submit.resolve({
        game: "snake",
        top: [{ username: "me", score: 1 }],
        best: 1,
        newBest: true,
      });
      lb.resolve({ game: "snake", top: [], best: null });
    });
    expect(onBest).not.toHaveBeenCalled();
    off();
  });

  // RACE: the overlay unmounts (Escape/close) during the death freeze. The
  // terminal score was recorded and submitted the moment the run ended, so
  // nothing is lost with the card still hidden.
  it("has already submitted the score when closed during the death freeze", () => {
    vi.useFakeTimers();
    const { unmount } = render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    endRun();

    // Freeze still pending: no card yet — but the submit already happened.
    expect(screen.queryByText("Game over")).toBeNull();
    expect(net.submitScore).toHaveBeenCalledTimes(1);
    expect(net.submitScore).toHaveBeenCalledWith("snake", expect.any(Number));
    unmount();
    expect(net.submitScore).toHaveBeenCalledTimes(1);
  });

  // RACE: a restart (here via the level picker, which stays clickable) lands
  // during the death freeze. The finished run keeps its submitted score, the
  // stale card never appears, and the new run starts clean.
  it("keeps the submitted score when restarted during the death freeze", () => {
    vi.useFakeTimers();
    setSettings({ snakeLevel: "open", snakeSpeed: "normal" });
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    endRun();
    expect(net.submitScore).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Game over")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Pillars" }));
    // The old freeze timer must be dead: no stale card, no double submit.
    elapseFreeze();
    expect(screen.queryByText("Game over")).toBeNull();
    expect(screen.getByText("Score 0")).toBeTruthy();
    expect(net.submitScore).toHaveBeenCalledTimes(1);
  });

  it("restarts instantly on a single key press", () => {
    vi.useFakeTimers();
    setSettings({ snakeLevel: "open", snakeSpeed: "normal" });
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    endRun();
    elapseFreeze();
    expect(screen.getByText("Game over")).toBeTruthy();

    // No clock manipulation needed: the monotonic run id remounts the game
    // even for a same-millisecond restart.
    act(() => {
      fireEvent.keyDown(window, { key: " " });
    });
    expect(screen.queryByText("Game over")).toBeNull();
    expect(screen.getByText("Score 0")).toBeTruthy();
  });

  it("ignores keys that are not restart keys while the card is up", () => {
    vi.useFakeTimers();
    setSettings({ snakeLevel: "open", snakeSpeed: "normal" });
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    endRun();
    elapseFreeze();
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowLeft" });
    });
    expect(screen.getByText("Game over")).toBeTruthy();
  });

  // Keyboard a11y (round-1 finding): while the card is up, Space/Enter aimed at
  // an interactive control must activate that control, not hijack a restart.
  it("does not steal Space/Enter from interactive controls on the card", () => {
    vi.useFakeTimers();
    setSettings({ snakeLevel: "open", snakeSpeed: "normal" });
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    endRun();
    elapseFreeze();
    expect(screen.getByText("Game over")).toBeTruthy();

    // Keydown originating from a focused control: left for the control.
    const close = screen.getByLabelText("Close arcade");
    close.focus();
    act(() => {
      fireEvent.keyDown(close, { key: "Enter" });
    });
    expect(screen.getByText("Game over")).toBeTruthy();

    // The same key from a non-interactive target still restarts.
    act(() => {
      fireEvent.keyDown(document.body, { key: "Enter" });
    });
    expect(screen.queryByText("Game over")).toBeNull();
    expect(screen.getByText("Score 0")).toBeTruthy();
  });
});
