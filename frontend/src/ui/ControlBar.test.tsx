import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bus } from "../game/eventBus";
import { setMediaPrefs } from "../media/mediaPrefs";

/**
 * Control-bar shell test: the media manager (LiveKit) is mocked, so assertions
 * target *which* manager calls fire and the rendered state (icon aria-label +
 * announced toast) — never Phaser or DOM internals. Prior art: App.test.tsx.
 */
const media = vi.hoisted(() => ({
  worldAudio: { setMicEnabled: vi.fn() },
  roomVideo: {
    setMicEnabled: vi.fn(),
    setCamEnabled: vi.fn(),
    setScreenShareEnabled: vi.fn(),
    isScreenSharing: vi.fn(() => false),
    onScreenShareChanged: vi.fn(() => () => {}),
  },
  stageVideo: { setMicEnabled: vi.fn(), setCamEnabled: vi.fn() },
}));
vi.mock("../media/livekit", () => media);
vi.mock("../net/auth", () => ({ USE_MOCK: false }));
// Keep the test focused on the bar; Settings + the WebAudio meter are out of scope.
vi.mock("./Settings", () => ({ default: () => <div data-testid="settings-stub" /> }));
vi.mock("./MicMeter", () => ({ default: () => null }));

import ControlBar from "./ControlBar";

beforeEach(() => {
  // A new browser session starts receive-only; tests that exercise turning a
  // device off first opt in explicitly.
  sessionStorage.clear();
  setMediaPrefs({ micOn: false, camOn: false });
  media.worldAudio.setMicEnabled.mockClear();
  media.roomVideo.setMicEnabled.mockClear();
  media.roomVideo.setCamEnabled.mockClear();
  media.stageVideo.setMicEnabled.mockClear();
  media.stageVideo.setCamEnabled.mockClear();
  media.roomVideo.setScreenShareEnabled.mockClear();
  media.roomVideo.isScreenSharing.mockReturnValue(false);
});
afterEach(cleanup);

describe("ControlBar", () => {
  it("renders mic, cam, a meeting-gated screen-share slot, and settings", () => {
    render(<ControlBar />);
    expect(screen.getByLabelText("Unmute microphone")).toBeTruthy();
    expect(screen.getByLabelText("Turn camera on")).toBeTruthy();
    // Screen share is disabled outside a meeting.
    const share = screen.getByLabelText("Share screen (available in meetings)") as HTMLButtonElement;
    expect(share.disabled).toBe(true);
    expect(screen.getByTestId("settings-stub")).toBeTruthy();
  });

  it("enables screen share only inside a meeting and publishes on click", () => {
    render(<ControlBar />);
    let shared: unknown;
    const off = bus.on("screen-share-on", () => (shared = true));
    // Entering a meeting (grid visible for this client) enables the button.
    act(() => bus.emit("meeting-grid-visible"));
    const share = screen.getByLabelText("Share your screen") as HTMLButtonElement;
    expect(share.disabled).toBe(false);

    fireEvent.click(share);
    expect(media.roomVideo.setScreenShareEnabled).toHaveBeenCalledWith(true);
    expect(shared).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Sharing your screen");
    off();

    // Leaving the meeting disables it again.
    act(() => bus.emit("meeting-grid-hidden"));
    expect(
      (screen.getByLabelText("Share screen (available in meetings)") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("mutes the mic across every active publisher and announces it", () => {
    setMediaPrefs({ micOn: true });
    render(<ControlBar />);
    let toggled: { on: boolean } | undefined;
    const off = bus.on<{ on: boolean }>("mic-toggle", (p) => (toggled = p));

    fireEvent.click(screen.getByLabelText("Mute microphone"));

    // Fans out to proximity voice, the room/meeting video AND the stage broadcast.
    expect(media.worldAudio.setMicEnabled).toHaveBeenCalledWith(false);
    expect(media.roomVideo.setMicEnabled).toHaveBeenCalledWith(false);
    expect(media.stageVideo.setMicEnabled).toHaveBeenCalledWith(false);
    // Icon/label flips and a bus event fires for the sound mixer's blip.
    expect(screen.getByLabelText("Unmute microphone")).toBeTruthy();
    expect(toggled).toEqual({ on: false });
    // Politely announced toast.
    expect(screen.getByRole("status").textContent).toBe("Microphone muted");
    off();
  });

  it("toggles the camera on the room and stage publishers and announces it", () => {
    setMediaPrefs({ camOn: true });
    render(<ControlBar />);
    fireEvent.click(screen.getByLabelText("Turn camera off"));
    expect(media.roomVideo.setCamEnabled).toHaveBeenCalledWith(false);
    expect(media.stageVideo.setCamEnabled).toHaveBeenCalledWith(false);
    expect(screen.getByLabelText("Turn camera on")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Camera off");
  });

  it("explicitly enables the microphone and keeps the control truthful", () => {
    render(<ControlBar />);
    fireEvent.click(screen.getByLabelText("Unmute microphone"));
    expect(media.worldAudio.setMicEnabled).toHaveBeenLastCalledWith(true);
    expect(screen.getByLabelText("Mute microphone")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Microphone on");
  });

  it("reverts the mic and announces when the transport denies the unmute (PRD 25.7)", async () => {
    // A publisher confirms the capture was blocked; the optimistic on must revert.
    media.worldAudio.setMicEnabled.mockResolvedValueOnce({ status: "denied" });
    render(<ControlBar />);
    fireEvent.click(screen.getByLabelText("Unmute microphone"));
    // Optimistically flips on immediately...
    expect(screen.getByLabelText("Mute microphone")).toBeTruthy();
    // ...then the confirmed denial reverts it to muted and announces the reason.
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "Microphone blocked — allow access in your browser",
      );
      expect(screen.getByLabelText("Unmute microphone")).toBeTruthy();
    });
  });

  it("keeps the camera on when the transport confirms the publish", async () => {
    media.roomVideo.setCamEnabled.mockResolvedValueOnce({ status: "live" });
    render(<ControlBar />);
    fireEvent.click(screen.getByLabelText("Turn camera on"));
    await waitFor(() => expect(media.roomVideo.setCamEnabled).toHaveBeenCalledWith(true));
    // No revert: the control stays on and never shows a failure toast.
    expect(screen.getByLabelText("Turn camera off")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Camera on");
  });
});
