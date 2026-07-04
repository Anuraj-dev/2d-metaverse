import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { bus } from "./game/eventBus";

/**
 * App-shell test: pins the world-audio ⇄ room-video ⇄ stage-video media-transition
 * chain and the connected/connecting HUD state. The game canvas and every HUD child
 * are stubbed; the LiveKit media manager and the net layer are mocked, so assertions
 * target *which* media-manager calls fire (and their serialization/unmount guards),
 * never Phaser or DOM internals.
 */

// --- Media manager (LiveKit) doubles -------------------------------------
const media = vi.hoisted(() => {
  const ok = () => vi.fn().mockResolvedValue(undefined);
  return {
    worldAudio: { start: ok(), stop: ok(), setMicEnabled: vi.fn() },
    roomVideo: {
      join: ok(),
      leave: ok(),
      onTracks: vi.fn(() => () => {}),
      setMicEnabled: vi.fn(),
      setCamEnabled: vi.fn(),
    },
    stageVideo: {
      joinAsAudience: ok(),
      joinAsPresenter: ok(),
      leave: ok(),
      onTracks: vi.fn(() => () => {}),
    },
  };
});
vi.mock("./media/livekit", () => media);

// --- Net double: a tiny emitter the test can drive -----------------------
const netMock = vi.hoisted(() => {
  const handlers: Record<string, Set<(p: unknown) => void>> = {};
  const net = {
    selfId: "",
    on: (ev: string, cb: (p: unknown) => void) => {
      const set = (handlers[ev] ??= new Set());
      set.add(cb);
      return () => set.delete(cb);
    },
    emit: (ev: string, p?: unknown) => handlers[ev]?.forEach((cb) => cb(p)),
    connect: vi.fn(),
    move: vi.fn(),
    chat: vi.fn(),
    whisper: vi.fn(),
    enterRoom: vi.fn(),
    leaveRoom: vi.fn(),
    sit: vi.fn(),
    stand: vi.fn(),
    disconnect: vi.fn(),
  };
  return { handlers, net };
});
vi.mock("./net/shared", () => ({ sharedNet: () => netMock.net }));

// --- Config: real mode, well-configured ----------------------------------
vi.mock("./net/auth", () => ({ USE_MOCK: false }));
vi.mock("./net/config", () => ({ MISCONFIGURED: false }));

// --- Heavy children stubbed so the test isolates App's orchestration ------
vi.mock("./game/GameCanvas", () => ({ default: () => <div data-testid="game-canvas" /> }));
vi.mock("./ui/Landing", () => ({
  default: (props: { onEntered: () => void }) => (
    <button onClick={props.onEntered}>enter-space</button>
  ),
}));
vi.mock("./ui/Roster", () => ({ default: () => null }));
vi.mock("./ui/Minimap", () => ({ default: () => null }));
vi.mock("./ui/Settings", () => ({ default: () => null }));
vi.mock("./ui/TouchControls", () => ({ default: () => null }));
vi.mock("./ui/HelpOverlay", () => ({ default: () => null }));
vi.mock("./ui/SfxBridge", () => ({ default: () => null }));
vi.mock("./ui/RoomAccessLayer", () => ({ default: () => null }));
vi.mock("./ui/BubbleLayer", () => ({ default: () => null }));
vi.mock("./ui/MediaControls", () => ({ default: () => null }));
vi.mock("./ui/InteractionHint", () => ({ default: () => null }));
vi.mock("./ui/InteractableModal", () => ({ default: () => null }));
vi.mock("./ui/StageScreen", () => ({ default: () => null }));
vi.mock("./ui/ChatBox", () => ({ default: () => null }));
vi.mock("./ui/ChatToast", () => ({ default: () => null }));
// The meeting overlay (lazy, motion + LiveKit components) is stubbed to a
// props echo so the app-shell tests assert App's portal orchestration —
// mount/unmount, reveal flag, backdrop, roster — not the visuals.
vi.mock("./ui/MeetingOverlay", () => ({
  default: (props: {
    revealed: boolean;
    backdrop: string | null;
    participants: { id: string }[];
    onBurstCovered: () => void;
  }) => (
    <div
      data-testid="meeting-overlay"
      data-revealed={String(props.revealed)}
      data-backdrop={props.backdrop ?? ""}
      data-count={props.participants.length}
    >
      <button onClick={props.onBurstCovered}>burst-covered</button>
    </div>
  ),
}));

import App from "./App";

const SELF = "me";

/** Enter the space and land the initial `init` so world audio starts. */
async function enterAndInit() {
  fireEvent.click(screen.getByText("enter-space"));
  await act(async () => {
    netMock.net.emit("init", { selfId: SELF });
  });
  await waitFor(() => expect(media.worldAudio.start).toHaveBeenCalledWith("1", SELF));
}

async function emit(fn: () => void) {
  await act(async () => {
    fn();
  });
}

/** A promise whose resolution the test controls — used to hold a transition open. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  netMock.net.selfId = "";
  for (const k of Object.keys(netMock.handlers)) delete netMock.handlers[k];
  for (const group of Object.values(media)) {
    for (const fn of Object.values(group)) if (vi.isMockFunction(fn)) fn.mockClear();
  }
});

afterEach(() => cleanup());

describe("App shell", () => {
  it("shows Landing until entered, then the stubbed game canvas", async () => {
    render(<App />);
    expect(screen.getByText("enter-space")).toBeTruthy();
    expect(screen.queryByTestId("game-canvas")).toBeNull();
    fireEvent.click(screen.getByText("enter-space"));
    // GameCanvas is lazy-loaded behind Suspense.
    expect(await screen.findByTestId("game-canvas")).toBeTruthy();
  });

  it("starts world audio on init and flips the HUD to connected", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("enter-space"));
    expect(await screen.findByText(/connecting/)).toBeTruthy();
    await act(async () => {
      netMock.net.emit("init", { selfId: SELF });
    });
    await waitFor(() => expect(screen.getByText(/🟢 connected/)).toBeTruthy());
    expect(media.worldAudio.start).toHaveBeenCalledWith("1", SELF);
    expect(media.worldAudio.start).toHaveBeenCalledTimes(1);
  });

  it("entering a private room stops world audio and leaves room video", async () => {
    render(<App />);
    await enterAndInit();
    await emit(() => bus.emit("room-entered", { roomId: "D" }));
    await waitFor(() => expect(media.worldAudio.stop).toHaveBeenCalled());
    expect(media.roomVideo.leave).toHaveBeenCalled();
  });

  it("sitting (seat-update for self) stops world audio and joins the room video", async () => {
    render(<App />);
    await enterAndInit();
    await emit(() => netMock.net.emit("seat-update", { roomId: "D", playerId: SELF }));
    await waitFor(() => expect(media.roomVideo.join).toHaveBeenCalledWith("D", SELF));
    expect(media.worldAudio.stop).toHaveBeenCalled();
  });

  it("ignores a seat-update for a different player", async () => {
    render(<App />);
    await enterAndInit();
    await emit(() => netMock.net.emit("seat-update", { roomId: "D", playerId: "someone-else" }));
    // give the promise chain a chance to (not) run
    await Promise.resolve();
    expect(media.roomVideo.join).not.toHaveBeenCalled();
  });

  it("standing leaves the room video", async () => {
    render(<App />);
    await enterAndInit();
    await emit(() => bus.emit("stood"));
    await waitFor(() => expect(media.roomVideo.leave).toHaveBeenCalled());
  });

  it("leaving a room leaves room video then restarts world audio", async () => {
    render(<App />);
    await enterAndInit();
    media.worldAudio.start.mockClear();
    await emit(() => bus.emit("room-left", { roomId: "D" }));
    await waitFor(() => expect(media.worldAudio.start).toHaveBeenCalledWith("1", SELF));
    expect(media.roomVideo.leave).toHaveBeenCalled();
  });

  it("stepping onto the stage joins as audience; leaving the stage leaves it", async () => {
    render(<App />);
    await enterAndInit();
    await emit(() => bus.emit("near-stage"));
    await waitFor(() => expect(media.stageVideo.joinAsAudience).toHaveBeenCalledWith("1", SELF));
    await emit(() => bus.emit("leave-stage"));
    await waitFor(() => expect(media.stageVideo.leave).toHaveBeenCalled());
  });

  it("holds a queued transition until the pending one fully settles, then runs in order", async () => {
    render(<App />);
    await enterAndInit();
    const gate = deferred();
    const order: string[] = [];
    // op1 (seat-update): stop world audio → join room video. Its first step
    // blocks on the gate so a second transition can pile up behind it.
    media.worldAudio.stop.mockImplementationOnce(() => {
      order.push("world-stop");
      return gate.promise;
    });
    media.roomVideo.join.mockImplementationOnce(async () => void order.push("room-join"));
    media.stageVideo.joinAsAudience.mockImplementationOnce(
      async () => void order.push("stage-join")
    );

    await emit(() => netMock.net.emit("seat-update", { roomId: "D", playerId: SELF }));
    // op2 (near-stage) enqueued while op1 is still pending on the gate.
    await emit(() => bus.emit("near-stage"));

    await waitFor(() => expect(order).toEqual(["world-stop"]));
    // Neither the rest of op1 nor any of op2 may start while op1 is pending —
    // this fails if the serialized mediaTransition queue is removed.
    expect(media.roomVideo.join).not.toHaveBeenCalled();
    expect(media.stageVideo.joinAsAudience).not.toHaveBeenCalled();

    gate.resolve();
    await waitFor(() =>
      expect(order).toEqual(["world-stop", "room-join", "stage-join"])
    );
  });

  it("shows the meeting countdown toast and clears it on cancellation", async () => {
    render(<App />);
    await enterAndInit();
    await emit(() =>
      netMock.net.emit("meeting-countdown", {
        roomId: "D",
        durationMs: 3000,
        participants: [
          { id: SELF, name: "me" },
          { id: "p2", name: "bob" },
        ],
      })
    );
    expect(await screen.findByTestId("meeting-countdown")).toBeTruthy();
    await emit(() =>
      netMock.net.emit("meeting-countdown-canceled", { roomId: "D", reason: "stand" })
    );
    expect(screen.queryByTestId("meeting-countdown")).toBeNull();
    expect(screen.queryByTestId("meeting-overlay")).toBeNull();
  });

  it("portals in on meeting-started: portal-enter fires, overlay mounts, reveal waits for A then B", async () => {
    render(<App />);
    await enterAndInit();
    const busEvents: string[] = [];
    const offEnter = bus.on("portal-enter", () => busEvents.push("portal-enter"));
    const offVisible = bus.on("meeting-grid-visible", () => busEvents.push("grid-visible"));

    await emit(() =>
      netMock.net.emit("meeting-started", {
        roomId: "D",
        participants: [
          { id: SELF, name: "me" },
          { id: "p2", name: "bob" },
        ],
      })
    );
    const overlay = await screen.findByTestId("meeting-overlay");
    expect(overlay.getAttribute("data-revealed")).toBe("false");
    expect(overlay.getAttribute("data-count")).toBe("2");
    await waitFor(() => expect(busEvents).toContain("portal-enter"));

    // Phase A finishes first (A-before-B ordering): still not revealed.
    await emit(() => bus.emit("portal-phase-a-done", { image: "data:image/png;base64,x" }));
    expect(screen.getByTestId("meeting-overlay").getAttribute("data-revealed")).toBe("false");
    expect(busEvents).not.toContain("grid-visible");

    // Phase B (burst covered) completes the pair: reveal, with the backdrop.
    fireEvent.click(screen.getByText("burst-covered"));
    await waitFor(() =>
      expect(screen.getByTestId("meeting-overlay").getAttribute("data-revealed")).toBe("true")
    );
    expect(screen.getByTestId("meeting-overlay").getAttribute("data-backdrop")).toBe(
      "data:image/png;base64,x"
    );
    expect(busEvents).toContain("grid-visible");
    offEnter();
    offVisible();
  });

  it("reveals with the opposite ordering too (B ready before A done)", async () => {
    render(<App />);
    await enterAndInit();
    await emit(() =>
      netMock.net.emit("meeting-started", {
        roomId: "D",
        participants: [
          { id: SELF, name: "me" },
          { id: "p2", name: "bob" },
        ],
      })
    );
    await screen.findByTestId("meeting-overlay");
    fireEvent.click(screen.getByText("burst-covered"));
    expect(screen.getByTestId("meeting-overlay").getAttribute("data-revealed")).toBe("false");
    await emit(() => bus.emit("portal-phase-a-done", { image: null }));
    await waitFor(() =>
      expect(screen.getByTestId("meeting-overlay").getAttribute("data-revealed")).toBe("true")
    );
  });

  it("portals out alone on own participant-left; a remote's departure only shrinks the roster", async () => {
    render(<App />);
    await enterAndInit();
    const busEvents: string[] = [];
    const offExit = bus.on("portal-exit", () => busEvents.push("portal-exit"));
    await emit(() =>
      netMock.net.emit("meeting-started", {
        roomId: "D",
        participants: [
          { id: SELF, name: "me" },
          { id: "p2", name: "bob" },
          { id: "p3", name: "cat" },
        ],
      })
    );
    await screen.findByTestId("meeting-overlay");

    // A remote leaves: overlay stays, roster shrinks.
    await emit(() =>
      netMock.net.emit("meeting-participant-left", { roomId: "D", playerId: "p2" })
    );
    expect(screen.getByTestId("meeting-overlay").getAttribute("data-count")).toBe("2");
    expect(busEvents).toEqual([]);

    // Own departure: overlay unmounts and the scene is woken via portal-exit.
    await emit(() =>
      netMock.net.emit("meeting-participant-left", { roomId: "D", playerId: SELF })
    );
    expect(screen.queryByTestId("meeting-overlay")).toBeNull();
    await waitFor(() => expect(busEvents).toContain("portal-exit"));
    offExit();
  });

  it("holds the media queue for Phase A and cancels it when self leaves mid-cinematic (no late reveal)", async () => {
    render(<App />);
    await enterAndInit();
    const busEvents: string[] = [];
    const offEnter = bus.on("portal-enter", () => busEvents.push("portal-enter"));
    const offExit = bus.on("portal-exit", () => busEvents.push("portal-exit"));
    const offVisible = bus.on("meeting-grid-visible", () => busEvents.push("grid-visible"));

    await emit(() =>
      netMock.net.emit("meeting-started", {
        roomId: "D",
        participants: [
          { id: SELF, name: "me" },
          { id: "p2", name: "bob" },
        ],
      })
    );
    await screen.findByTestId("meeting-overlay");
    await waitFor(() => expect(busEvents).toContain("portal-enter"));

    // Phase A is still running (no portal-phase-a-done): the portal-in op must
    // HOLD the queue — an op enqueued behind it may not start.
    await emit(() => bus.emit("near-stage"));
    expect(media.stageVideo.joinAsAudience).not.toHaveBeenCalled();

    // Self leaves mid-cinematic: cancellation settles the pending Phase A, the
    // queue drains in order (portal-exit runs, then the stage join), and the
    // overlay is gone.
    await emit(() =>
      netMock.net.emit("meeting-participant-left", { roomId: "D", playerId: SELF })
    );
    await waitFor(() => expect(busEvents).toContain("portal-exit"));
    await waitFor(() => expect(media.stageVideo.joinAsAudience).toHaveBeenCalled());
    expect(busEvents.indexOf("portal-enter")).toBeLessThan(busEvents.indexOf("portal-exit"));
    expect(screen.queryByTestId("meeting-overlay")).toBeNull();

    // The abandoned cinematic completing late must be inert: no overlay
    // resurrection, no reveal. (Scene-side, the portal generation guard makes
    // the same late callback skip its snapshot/sleep entirely.)
    await emit(() => bus.emit("portal-phase-a-done", { image: "data:late" }));
    expect(screen.queryByTestId("meeting-overlay")).toBeNull();
    expect(busEvents).not.toContain("grid-visible");
    offEnter();
    offExit();
    offVisible();
  });

  it("leaving before the queued Phase A op starts never wedges: it skips the cinematic and exits", async () => {
    // Regression for the meeting-Leave stuck bug. The portal-in media-queue op
    // is queued BEHIND a still-pending seat transition, so it has not begun
    // when the leave arrives (settlePhaseA is still null — the old short-circuit
    // silently lost the release and the exit op stalled behind an entry that
    // never resolved). The machine now cancels the not-yet-started entry.
    render(<App />);
    await enterAndInit();
    const busEvents: string[] = [];
    const offEnter = bus.on("portal-enter", () => busEvents.push("portal-enter"));
    const offExit = bus.on("portal-exit", () => busEvents.push("portal-exit"));

    // Gate op1 (seat-update) so the portal-in op cannot start behind it.
    const gate = deferred();
    media.worldAudio.stop.mockImplementationOnce(() => gate.promise);
    await emit(() => netMock.net.emit("seat-update", { roomId: "D", playerId: SELF }));
    await waitFor(() => expect(media.worldAudio.stop).toHaveBeenCalledTimes(1));

    // Meeting starts (portal-in op enqueued, NOT started — held behind the gate).
    await emit(() =>
      netMock.net.emit("meeting-started", {
        roomId: "D",
        participants: [
          { id: SELF, name: "me" },
          { id: "p2", name: "bob" },
        ],
      })
    );
    await screen.findByTestId("meeting-overlay");
    expect(busEvents).not.toContain("portal-enter");

    // Leave arrives before the entry op ran: portal-out enqueued behind it.
    await emit(() =>
      netMock.net.emit("meeting-participant-left", { roomId: "D", playerId: SELF })
    );
    expect(screen.queryByTestId("meeting-overlay")).toBeNull();

    // Drain the queue: the entry op self-cancels (no portal-enter into a world
    // we already left), and the exit op wakes the world. Old code stalled here.
    gate.resolve();
    await waitFor(() => expect(busEvents).toContain("portal-exit"));
    expect(busEvents).not.toContain("portal-enter");
    offEnter();
    offExit();
  });

  it("a latecomer portals in on their own participant-joined", async () => {
    render(<App />);
    await enterAndInit();
    await emit(() =>
      netMock.net.emit("meeting-participant-joined", {
        roomId: "D",
        participant: { id: SELF, name: "me" },
        participants: [
          { id: "p2", name: "bob" },
          { id: "p3", name: "cat" },
          { id: SELF, name: "me" },
        ],
      })
    );
    const overlay = await screen.findByTestId("meeting-overlay");
    expect(overlay.getAttribute("data-count")).toBe("3");
    expect(overlay.getAttribute("data-revealed")).toBe("false");
  });

  it("unmount mid-transition: queued ops are dropped, teardown waits for the pending op", async () => {
    const { unmount } = render(<App />);
    await enterAndInit();
    const gate = deferred();
    media.worldAudio.stop.mockImplementationOnce(() => gate.promise);

    // op1 starts and blocks on the gate…
    await emit(() => netMock.net.emit("seat-update", { roomId: "D", playerId: SELF }));
    await waitFor(() => expect(media.worldAudio.stop).toHaveBeenCalledTimes(1));
    // …op2 is queued behind it, not yet started.
    await emit(() => bus.emit("near-stage"));
    expect(media.stageVideo.joinAsAudience).not.toHaveBeenCalled();

    unmount();
    // Teardown must not run while op1 is still pending.
    expect(media.stageVideo.leave).not.toHaveBeenCalled();

    gate.resolve();
    await waitFor(() => {
      expect(media.roomVideo.leave).toHaveBeenCalled();
      expect(media.stageVideo.leave).toHaveBeenCalled();
    });
    // op1 had already started, so it ran to completion after the gate opened…
    expect(media.roomVideo.join).toHaveBeenCalledWith("D", SELF);
    // …but the queued op2 was dropped by the disposed guard.
    expect(media.stageVideo.joinAsAudience).not.toHaveBeenCalled();

    // Listeners are gone: a post-unmount bus event triggers no new joins.
    bus.emit("near-stage");
    await Promise.resolve();
    expect(media.stageVideo.joinAsAudience).not.toHaveBeenCalled();
  });
});
