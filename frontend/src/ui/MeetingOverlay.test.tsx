import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { bus } from "../game/eventBus";

const media = vi.hoisted(() => ({
  roomVideo: {
    lkRoom: null as unknown,
    onRoomChanged: vi.fn(() => () => {}),
    setMicEnabled: vi.fn(),
    setCamEnabled: vi.fn(),
  },
}));
vi.mock("../media/livekit", () => media);
vi.mock("./MeetingGrid", () => ({
  default: (props: { participants: { id: string }[] }) => (
    <div data-testid="grid-stub" data-count={props.participants.length} />
  ),
}));
// The overlay owns its chat subscription now; stub the net so it mounts without
// a live socket (the send/receive path is covered by MeetingChatPanel + e2e).
const net = vi.hoisted(() => ({ on: vi.fn(() => () => {}), meetingChat: vi.fn() }));
vi.mock("../net/shared", () => ({ sharedNet: () => net }));

import MeetingOverlay from "./MeetingOverlay";

const roster = [
  { id: "me", name: "raja" },
  { id: "p2", name: "bob" },
];

function renderOverlay(revealed: boolean, backdrop: string | null = null) {
  return render(
    <MeetingOverlay
      backdrop={backdrop}
      revealed={revealed}
      participants={roster}
      selfId="me"
      seat={{ sx: 100, sy: 120 }}
      onBurstCovered={() => {}}
    />
  );
}

afterEach(() => {
  cleanup();
  media.roomVideo.setMicEnabled.mockClear();
  media.roomVideo.setCamEnabled.mockClear();
});

describe("MeetingOverlay", () => {
  it("shows the warp burst (no grid) before the reveal", () => {
    const { container } = renderOverlay(false);
    expect(container.querySelector(".portal-burst")).toBeTruthy();
    expect(screen.queryByTestId("grid-stub")).toBeNull();
    // The seat ghost is armed for the seat→tile layoutId morph.
    expect(container.querySelector(".meet-seat-ghost")).toBeTruthy();
  });

  it("cross-fades to the grid over the blurred snapshot after the reveal", () => {
    const { container } = renderOverlay(true, "data:image/png;base64,abc");
    expect(screen.getByTestId("grid-stub").getAttribute("data-count")).toBe("2");
    const backdrop = container.querySelector(".meeting-backdrop") as HTMLElement;
    expect(backdrop.style.backgroundImage).toContain("data:image/png;base64,abc");
  });

  it("mounts the in-meeting chat panel alongside the grid once revealed", () => {
    renderOverlay(true);
    expect(screen.getByTestId("meeting-chat")).toBeTruthy();
    // …and not before the reveal (the burst still covers the viewport).
    cleanup();
    renderOverlay(false);
    expect(screen.queryByTestId("meeting-chat")).toBeNull();
  });

  it("still renders a backdrop when the frame snapshot failed", () => {
    const { container } = renderOverlay(true, null);
    const backdrop = container.querySelector(".meeting-backdrop") as HTMLElement;
    expect(backdrop).toBeTruthy();
    expect(backdrop.style.backgroundImage).toBe("");
  });

  it("Leave stands up via the bus (per-person portal-out path)", () => {
    renderOverlay(true);
    let stood = false;
    const off = bus.on("do-stand", () => {
      stood = true;
    });
    fireEvent.click(screen.getByTitle("Leave meeting"));
    expect(stood).toBe(true);
    off();
  });

  it("mic/cam toggles drive the existing room connection", () => {
    renderOverlay(true);
    fireEvent.click(screen.getByLabelText("Mute microphone"));
    expect(media.roomVideo.setMicEnabled).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByLabelText("Turn camera off"));
    expect(media.roomVideo.setCamEnabled).toHaveBeenCalledWith(false);
  });
});
