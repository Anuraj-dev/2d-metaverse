import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ArcadeLeaderboard } from "@metaverse/shared";

const net = vi.hoisted(() => ({
  fetchLeaderboard: vi.fn(),
  submitScore: vi.fn(),
}));
vi.mock("../../net/arcade", () => net);

/**
 * Opt-in SnakeGame stub: with `stub` set, the game is a single button that
 * reports a fixed positive score as game over — the only way to reach the
 * `over` phase with a known score deterministically. Off by default so every
 * other test keeps the real game.
 */
const snakeCtl = vi.hoisted(() => ({ stub: false, finalScore: 21 }));
vi.mock("./SnakeGame", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./SnakeGame")>();
  const Real = actual.default;
  const SnakeGameSwitch = (props: ArcadeGameProps) =>
    snakeCtl.stub ? (
      <button
        type="button"
        data-testid="stub-game-over"
        onClick={() => props.onGameOver(snakeCtl.finalScore)}
      >
        end run
      </button>
    ) : (
      <Real {...props} />
    );
  return { default: SnakeGameSwitch };
});

import ArcadeOverlay from "./ArcadeOverlay";
import { TERMINAL_HOLD_MS } from "./terminalHold";
import { bus } from "../../game/eventBus";
import { getSettings, setSettings } from "../settings";
import type { ArcadeGameProps } from "./gameTypes";

const board: ArcadeLeaderboard = {
  game: "snake",
  top: [{ username: "ada", score: 42 }],
  best: 17,
};

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Panels stay mounted for their exit animation — openness is an attribute. */
function panelOpen(name: "pause" | "over" | "auto"): boolean {
  return document.querySelector(`[data-panel="${name}"]`)?.getAttribute("data-open") === "true";
}

function menuItem(name: string): HTMLElement {
  return screen.getByRole("menuitem", { name });
}

/** Install the Fullscreen API bits jsdom lacks; returns the spies + a setter. */
function stubFullscreen() {
  let fsElement: Element | null = null;
  const request = vi.fn().mockResolvedValue(undefined);
  const exit = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: request,
  });
  Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fsElement,
  });
  return {
    request,
    exit,
    /** Pretend the browser granted (true) or dropped (false) fullscreen. */
    async set(on: boolean) {
      fsElement = on ? document.querySelector(".arcade-backdrop") : null;
      await act(async () => {
        fireEvent(document, new Event("fullscreenchange"));
      });
    },
    restore() {
      Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
      Reflect.deleteProperty(document, "exitFullscreen");
      Reflect.deleteProperty(document, "fullscreenElement");
    },
  };
}

beforeEach(() => {
  net.fetchLeaderboard.mockResolvedValue(board);
  net.submitScore.mockResolvedValue({ ...board, newBest: false });
  // jsdom has no canvas backend; renderers guard a null context.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  snakeCtl.stub = false;
});

describe("ArcadeOverlay leaderboard", () => {
  it("shows skeleton rows while loading, then the best + top-N", async () => {
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    expect(document.querySelectorAll(".arcade-skel")).toHaveLength(3);

    expect(await screen.findByText("ada")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("Your best").nextElementSibling?.textContent).toBe("17");
    expect(document.querySelectorAll(".arcade-skel")).toHaveLength(0);
  });

  it("marks the caller's own row", async () => {
    net.fetchLeaderboard.mockResolvedValue({
      game: "snake",
      top: [
        { username: "ada", score: 42 },
        { username: "me", score: 17 },
      ],
      best: 17,
    } satisfies ArcadeLeaderboard);
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    await screen.findByText("ada");
    expect(document.querySelectorAll(".arcade-row--me")).toHaveLength(1);
    expect(screen.getByText("you").closest(".arcade-row")?.textContent).toContain("me");
  });

  it("shows an empty state when nobody has played", async () => {
    net.fetchLeaderboard.mockResolvedValue({
      game: "snake",
      top: [],
      best: null,
    } satisfies ArcadeLeaderboard);
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    expect(await screen.findByText(/No scores yet/)).toBeTruthy();
  });

  it("shows a failure state when the fetch rejects", async () => {
    net.fetchLeaderboard.mockRejectedValue(new Error("offline"));
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    expect(await screen.findByText("Scores unavailable")).toBeTruthy();
  });
});

describe("ArcadeOverlay pause menu", () => {
  it("Escape pauses with Resume focused; Escape again resumes", () => {
    const onClose = vi.fn();
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={onClose} />);
    expect(panelOpen("pause")).toBe(false);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(panelOpen("pause")).toBe(true);
    expect(document.activeElement).toBe(menuItem("Resume"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(panelOpen("pause")).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("arrow to Quit + Enter closes the overlay", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(document.activeElement).toBe(menuItem("Quit"));

    fireEvent.keyDown(window, { key: "Enter" });
    // The fade runs before the parent unmounts us.
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector(".arcade-backdrop")?.getAttribute("data-closing")).toBe("true");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wraps the selection with ArrowUp", () => {
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={() => {}} />);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(document.activeElement).toBe(menuItem("Quit"));
  });

  it("Restart resets the run and leaves the overlay open", () => {
    const onClose = vi.fn();
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(menuItem("Restart"));
    expect(panelOpen("pause")).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector(".arcade-scorenum")?.textContent).toBe("0");
  });

  it("the header Quit button opens the menu with Quit selected", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Quit arcade"));
    expect(panelOpen("pause")).toBe(true);
    expect(document.activeElement).toBe(menuItem("Quit"));

    fireEvent.click(menuItem("Quit"));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hover moves the selection", () => {
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={() => {}} />);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerEnter(menuItem("Restart"));
    expect(document.activeElement).toBe(menuItem("Restart"));
  });
});

describe("ArcadeOverlay fullscreen", () => {
  it("never takes fullscreen on open; the header toggle does, without pausing", async () => {
    const fs = stubFullscreen();
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={() => {}} />);
    expect(fs.request).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Enter fullscreen"));
    });
    expect(fs.request).toHaveBeenCalledTimes(1);
    await fs.set(true);
    expect(panelOpen("pause")).toBe(false);

    // Toggling it back off is deliberate — it must not pause the run.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Exit fullscreen"));
    });
    expect(fs.exit).toHaveBeenCalledTimes(1);
    await fs.set(false);
    expect(panelOpen("pause")).toBe(false);

    fs.restore();
  });

  it("re-enables the toggle when requestFullscreen throws synchronously", async () => {
    const fs = stubFullscreen();
    fs.request.mockImplementationOnce(() => {
      throw new Error("fullscreen denied");
    });
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={() => {}} />);

    const toggle = screen.getByLabelText("Enter fullscreen");
    await act(async () => {
      fireEvent.click(toggle);
    });

    if (!(toggle instanceof HTMLButtonElement)) throw new Error("fullscreen toggle missing");
    expect(toggle.disabled).toBe(false);
    fs.restore();
  });

  // In real fullscreen the browser eats the first Escape and the page never
  // sees the keydown — the resulting fullscreen exit must pause instead.
  it("pauses when fullscreen is exited behind our back, and Resume takes it back", async () => {
    const fs = stubFullscreen();
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Enter fullscreen"));
    });
    await fs.set(true);
    expect(panelOpen("pause")).toBe(false);

    await fs.set(false);
    expect(panelOpen("pause")).toBe(true);

    fs.request.mockClear();
    await act(async () => {
      fireEvent.click(menuItem("Resume"));
    });
    expect(panelOpen("pause")).toBe(false);
    expect(fs.request).toHaveBeenCalledTimes(1);

    fs.restore();
  });

  it("Resume after a plain Escape pause does not request fullscreen", async () => {
    const fs = stubFullscreen();
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={() => {}} />);
    fireEvent.keyDown(window, { key: "Escape" });
    await act(async () => {
      fireEvent.click(menuItem("Resume"));
    });
    expect(panelOpen("pause")).toBe(false);
    expect(fs.request).not.toHaveBeenCalled();

    fs.restore();
  });

  it("drops fullscreen on quit", async () => {
    vi.useFakeTimers();
    const fs = stubFullscreen();
    const onClose = vi.fn();
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={onClose} />);
    await fs.set(true);

    fireEvent.click(screen.getByLabelText("Quit arcade"));
    fireEvent.click(menuItem("Quit"));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(fs.exit).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    fs.restore();
  });
});

describe("ArcadeOverlay auto-pause", () => {
  it("blur pauses without a menu, refocus resumes", () => {
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={() => {}} />);
    fireEvent.blur(window);
    expect(panelOpen("auto")).toBe(true);
    expect(panelOpen("pause")).toBe(false);

    fireEvent.focus(window);
    expect(panelOpen("auto")).toBe(false);
  });

  it("Escape is inert while auto-paused", () => {
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={() => {}} />);
    fireEvent.blur(window);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(panelOpen("pause")).toBe(false);
    expect(panelOpen("auto")).toBe(true);
  });

  it("clicking the scrim resumes", () => {
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={() => {}} />);
    fireEvent.blur(window);
    const scrim = document.querySelector('[data-panel="auto"]');
    if (!(scrim instanceof HTMLElement)) throw new Error("auto-pause scrim missing");
    fireEvent.click(scrim);
    expect(panelOpen("auto")).toBe(false);
  });
});

describe("ArcadeOverlay run lifecycle", () => {
  it("submits immediately, holds terminal feedback, then trusts the server's best verdict", async () => {
    vi.useFakeTimers();
    snakeCtl.stub = true;
    net.submitScore.mockResolvedValue({ ...board, best: 21, newBest: true });
    const bestEvents: number[] = [];
    const off = bus.on("arcade-best", () => bestEvents.push(1));
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);

    fireEvent.click(screen.getByTestId("stub-game-over"));
    expect(net.submitScore).toHaveBeenCalledWith("snake", 21);
    expect(panelOpen("over")).toBe(false);

    await act(async () => {
      await Promise.resolve();
    });
    expect(bestEvents).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(TERMINAL_HOLD_MS.snake - 1);
    });
    expect(panelOpen("over")).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(panelOpen("over")).toBe(true);
    expect(screen.getByText("New best!")).toBeTruthy();
    off();
  });

  it("shows the terminal card immediately when reduced motion is enabled", () => {
    vi.useFakeTimers();
    snakeCtl.stub = true;
    setSettings({ reducedMotion: "on" });
    try {
      render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
      fireEvent.click(screen.getByTestId("stub-game-over"));
      expect(panelOpen("over")).toBe(false);
      act(() => {
        vi.advanceTimersByTime(0);
      });
      expect(panelOpen("over")).toBe(true);
    } finally {
      setSettings({ reducedMotion: "system" });
    }
  });

  it("does not celebrate a late result from a run that was restarted", async () => {
    vi.useFakeTimers();
    snakeCtl.stub = true;
    const pending = deferred<ArcadeLeaderboard & { newBest: boolean }>();
    net.submitScore.mockReturnValue(pending.promise);
    const bestEvents: number[] = [];
    const off = bus.on("arcade-best", () => bestEvents.push(1));
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);

    fireEvent.click(screen.getByTestId("stub-game-over"));
    act(() => {
      vi.advanceTimersByTime(TERMINAL_HOLD_MS.snake);
    });
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    await act(async () => {
      pending.resolve({ ...board, best: 21, newBest: true });
    });

    expect(bestEvents).toHaveLength(0);
    expect(screen.queryByText("New best!")).toBeNull();
    off();
  });

  it("submits the score and shows the game-over card; Play again restarts", async () => {
    vi.useFakeTimers();
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    // Snake sits in a difficulty menu until started — clicking a difficulty starts the run.
    fireEvent.click(screen.getByRole("button", { name: /normal/i }));
    // Heading right on the default board walks into the wall; the renderer
    // submits immediately and the overlay holds its terminal card briefly.
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(panelOpen("over")).toBe(true);
    expect(screen.getByText("Game over")).toBeTruthy();
    expect(net.submitScore).toHaveBeenCalledWith("snake", expect.any(Number));

    const playAgain = screen.getByRole("button", { name: "Play again" });
    expect(document.activeElement).toBe(playAgain);
    fireEvent.click(playAgain);
    expect(panelOpen("over")).toBe(false);
  });

  it("Escape on the game-over card quits", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<ArcadeOverlay game="snake" label="Snake" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /normal/i }));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(panelOpen("over")).toBe(true);

    fireEvent.keyDown(window, { key: "Escape" });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Regression: the header Quit used to replace `over` with the pause menu,
  // whose Resume then set `playing` on a terminal game — dead screen.
  it("header Quit on the game-over card closes directly, never the pause menu", () => {
    vi.useFakeTimers();
    snakeCtl.stub = true;
    const onClose = vi.fn();
    render(<ArcadeOverlay game="snake" label="Snake" onClose={onClose} />);
    fireEvent.click(screen.getByTestId("stub-game-over"));
    act(() => {
      vi.advanceTimersByTime(TERMINAL_HOLD_MS.snake);
    });
    expect(panelOpen("over")).toBe(true);

    fireEvent.click(screen.getByLabelText("Quit arcade"));
    expect(panelOpen("pause")).toBe(false);
    expect(document.querySelector(".arcade-backdrop")?.getAttribute("data-closing")).toBe(
      "true"
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not claim a new best while the previous best is unknown (slow GET)", async () => {
    vi.useFakeTimers();
    snakeCtl.stub = true;
    let resolveBoard: (b: ArcadeLeaderboard) => void = () => {};
    net.fetchLeaderboard.mockReturnValue(
      new Promise<ArcadeLeaderboard>((res) => {
        resolveBoard = res;
      })
    );
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    // Game over (score 21) lands before the leaderboard GET has resolved:
    // with no KNOWN previous best there must be no "New best!" claim.
    fireEvent.click(screen.getByTestId("stub-game-over"));
    act(() => {
      vi.advanceTimersByTime(TERMINAL_HOLD_MS.snake);
    });
    expect(panelOpen("over")).toBe(true);
    expect(screen.queryByText("New best!")).toBeNull();

    // The slow GET (best 17 < 21) resolving after game over must not
    // retro-flag the chip, and neither must the submit-response refresh.
    await act(async () => {
      resolveBoard(board);
    });
    expect(screen.queryByText("New best!")).toBeNull();
  });

  it("shows a new best only when the submit response says it is authoritative", async () => {
    snakeCtl.stub = true;
    net.submitScore.mockResolvedValue({ ...board, best: 21, newBest: true });
    render(<ArcadeOverlay game="snake" label="Snake" onClose={() => {}} />);
    await screen.findByText("ada");
    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId("stub-game-over"));
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(TERMINAL_HOLD_MS.snake);
    });
    expect(screen.getByText("New best!")).toBeTruthy();
  });
});

describe("ArcadeOverlay paused input gating", () => {
  it("flap input is ignored while paused (no run mutation or audio behind the scrim)", () => {
    const flaps: number[] = [];
    const off = bus.on("arcade-flap", () => flaps.push(1));
    render(<ArcadeOverlay game="flappy" label="Flappy" onClose={() => {}} />);

    // Sanity: input reaches the game while playing.
    fireEvent.keyDown(window, { key: " " });
    expect(flaps).toHaveLength(1);

    // Auto-pause (blur): the overlay does not swallow game keys here, so only
    // the game's own paused gate stands between the input and the run.
    fireEvent.blur(window);
    fireEvent.keyDown(window, { key: " " });
    const canvas = document.querySelector(".arcade-canvas--fill");
    if (!(canvas instanceof HTMLElement)) throw new Error("flappy canvas missing");
    fireEvent.pointerDown(canvas);
    expect(flaps).toHaveLength(1);

    // Refocus resumes — input flows again.
    fireEvent.focus(window);
    fireEvent.keyDown(window, { key: " " });
    expect(flaps).toHaveLength(2);
    off();
  });
});

describe("ArcadeOverlay chrome", () => {
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
});

describe("ArcadeOverlay merge-drop registry", () => {
  // Arcade 2.0: the merge-drop cabinet is registered like any other game — the
  // overlay resolves it from the shared registry and its renderer mounts on a
  // canvas, with its own leaderboard fetched for the same REST resource.
  it("mounts the merge-drop cabinet from the shared registry", async () => {
    net.fetchLeaderboard.mockResolvedValue({
      game: "merge-drop",
      top: [{ username: "ada", score: 42 }],
      best: 17,
    });
    render(<ArcadeOverlay game="merge-drop" label="Stellar Forge" onClose={() => {}} />);
    expect(await screen.findByText("Your best")).toBeTruthy();
    expect(screen.getByText("Your best").nextElementSibling?.textContent).toBe("17");
    expect(net.fetchLeaderboard).toHaveBeenCalledWith("merge-drop");
    expect(document.querySelector("canvas.arcade-canvas")).toBeTruthy();
    expect(screen.getByLabelText("Stellar Forge arcade")).toBeTruthy();
  });
});
