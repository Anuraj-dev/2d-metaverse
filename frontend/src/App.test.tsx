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
      (handlers[ev] ??= new Set()).add(cb);
      return () => handlers[ev].delete(cb);
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
vi.mock("./ui/RoomKeyModal", () => ({ default: () => null }));
vi.mock("./ui/BubbleLayer", () => ({ default: () => null }));
vi.mock("./ui/MediaControls", () => ({ default: () => null }));
vi.mock("./ui/InteractionHint", () => ({ default: () => null }));
vi.mock("./ui/InteractableModal", () => ({ default: () => null }));
vi.mock("./ui/StageScreen", () => ({ default: () => null }));
vi.mock("./ui/ChatBox", () => ({ default: () => null }));
vi.mock("./ui/ChatToast", () => ({ default: () => null }));

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

  it("serializes overlapping transitions in order", async () => {
    render(<App />);
    await enterAndInit();
    const order: string[] = [];
    media.worldAudio.stop.mockImplementation(async () => void order.push("stop-world"));
    media.roomVideo.join.mockImplementation(async () => void order.push("join-room"));
    await emit(() => netMock.net.emit("seat-update", { roomId: "D", playerId: SELF }));
    await waitFor(() => expect(order).toEqual(["stop-world", "join-room"]));
  });

  it("tears down all media on unmount and drops listeners", async () => {
    const { unmount } = render(<App />);
    await enterAndInit();
    unmount();
    await waitFor(() => {
      expect(media.roomVideo.leave).toHaveBeenCalled();
      expect(media.stageVideo.leave).toHaveBeenCalled();
      expect(media.worldAudio.stop).toHaveBeenCalled();
    });
    // Listeners are gone: a post-unmount bus event triggers no new joins.
    media.stageVideo.joinAsAudience.mockClear();
    bus.emit("near-stage");
    await Promise.resolve();
    expect(media.stageVideo.joinAsAudience).not.toHaveBeenCalled();
  });
});
