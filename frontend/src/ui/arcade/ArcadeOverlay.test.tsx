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
import { initSnake, snakeLevelById, SNAKE_LEVELS, SNAKE_SPEEDS } from "../../game/arcade/snake";
import { toSeed } from "../../game/arcade/prng";
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
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  /**
   * A clock reading whose run seed puts Snake's first apple straight ahead of
   * the Open Field start, so the run scores at least once with no input before
   * dying on the right wall. Derived from the actual game module (the overlay
   * seeds a run with toSeed(Date.now())) instead of a hard-coded timestamp, so
   * it survives PRNG or level changes.
   */
  function scoringClock(): number {
    const level = snakeLevelById("open");
    const base = 1_700_000_000_000;
    for (let t = base; t < base + 5_000; t++) {
      const s = initSnake(toSeed(t), level);
      const head = s.body[0];
      if (head && s.food.y === head.y && s.food.x > head.x) return t;
    }
    throw new Error("no scoring clock found in range");
  }

  /** Advance far enough for the snake to hit the right wall (run terminal). */
  function endRun(ms = 3000) {
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

  it("celebrates a personal best and emits the domain event for the mixer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(scoringClock());
    setSettings({ snakeLevel: "open", snakeSpeed: "normal" });
    const lb = deferred<ArcadeLeaderboard>();
    net.fetchLeaderboard.mockReturnValue(lb.promise);
    const onBest = vi.fn();
    const off = bus.on("arcade-best", onBest);

    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    // The pre-run best becomes known before the run ends.
    await act(async () => {
      lb.resolve({ game: "snake", top: [], best: null });
    });
    endRun();
    elapseFreeze();

    expect(screen.getByText("Game over")).toBeTruthy();
    // Both the live scoreline and the game-over card show the scoring total.
    expect(screen.getAllByText(/Score [1-9]/).length).toBeGreaterThan(0);
    expect(screen.getByText("New personal best!")).toBeTruthy();
    expect(onBest).toHaveBeenCalledTimes(1);
    off();
  });

  it("does not celebrate a run that fails to beat the standing best", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(scoringClock());
    setSettings({ snakeLevel: "open", snakeSpeed: "normal" });
    const lb = deferred<ArcadeLeaderboard>();
    net.fetchLeaderboard.mockReturnValue(lb.promise);
    const onBest = vi.fn();
    const off = bus.on("arcade-best", onBest);

    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    // Standing best far above anything this short run scores.
    await act(async () => {
      lb.resolve({ game: "snake", top: [{ username: "ada", score: 42 }], best: 17 });
    });
    endRun();
    elapseFreeze();

    expect(screen.getByText("Game over")).toBeTruthy();
    expect(screen.queryByText("New personal best!")).toBeNull();
    expect(onBest).not.toHaveBeenCalled();
    off();
  });

  // RACE: the run ends while the leaderboard fetch is still pending. No best
  // may be announced from unknown data; once the authoritative answer arrives,
  // the (correct) celebration fires.
  it("defers the personal-best decision until the leaderboard resolves", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(scoringClock());
    setSettings({ snakeLevel: "open", snakeSpeed: "normal" });
    const lb = deferred<ArcadeLeaderboard>();
    net.fetchLeaderboard.mockReturnValue(lb.promise);
    // Keep the submit pending too, so the pre-run fetch is unambiguously the
    // first authoritative data to arrive.
    const submit = deferred<ArcadeLeaderboard>();
    net.submitScore.mockReturnValue(submit.promise);
    const onBest = vi.fn();
    const off = bus.on("arcade-best", onBest);

    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    endRun();
    elapseFreeze();

    // Card up, score submitted — but no celebration from a pending fetch.
    expect(screen.getByText("Game over")).toBeTruthy();
    expect(net.submitScore).toHaveBeenCalledWith("snake", expect.any(Number));
    expect(screen.queryByText("New personal best!")).toBeNull();
    expect(onBest).not.toHaveBeenCalled();

    // The authoritative pre-run best lands: first-ever score → celebrate now.
    await act(async () => {
      lb.resolve({ game: "snake", top: [], best: null });
    });
    expect(screen.getByText("New personal best!")).toBeTruthy();
    expect(onBest).toHaveBeenCalledTimes(1);
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
