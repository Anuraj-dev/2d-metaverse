import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SERVER_EVENTS, type ChatCooldownPayload, type MeetingChatMessage } from "@metaverse/shared";
import { bus } from "../game/eventBus";

vi.mock("./MeetingGrid", () => ({
  default: (props: { participants: { id: string }[] }) => (
    <div data-testid="grid-stub" data-count={props.participants.length} />
  ),
}));
// The overlay owns its chat subscription now; stub the net so it mounts without
// a live socket (the send/receive path is covered by MeetingChatPanel + e2e).
const net = vi.hoisted(() => ({
  on: vi.fn(() => () => {}) as unknown as Mock<(event: string, cb: (m: unknown) => void) => () => void>,
  meetingChat: vi.fn(),
}));
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
  net.on.mockClear();
  // Session-remembered chat-open pref must not leak across cases.
  sessionStorage.clear();
});

/** Grab the overlay's registered meeting-chat handler and feed it a message. */
function deliverChat(text: string, id = "p2", name = "bob"): void {
  const call = net.on.mock.calls.find((c) => c[0] === SERVER_EVENTS.meetingChat);
  const handler = call?.[1] as ((m: MeetingChatMessage) => void) | undefined;
  if (!handler) throw new Error("meeting-chat handler not registered");
  act(() => handler({ roomId: "1", id, name, text }));
}

/** Grab the overlay's chat-cooldown handler and feed it a payload. */
function deliverCooldown(payload: ChatCooldownPayload): void {
  const call = net.on.mock.calls.find((c) => c[0] === SERVER_EVENTS.chatCooldown);
  const handler = call?.[1] as ((p: ChatCooldownPayload) => void) | undefined;
  if (!handler) throw new Error("chat-cooldown handler not registered");
  act(() => handler(payload));
}

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

  it("no longer renders duplicate mic/cam controls (they live on the global bar)", () => {
    renderOverlay(true);
    expect(screen.queryByLabelText("Mute microphone")).toBeNull();
    expect(screen.queryByLabelText("Turn camera off")).toBeNull();
  });

  it("shows a decluttered top bar: participant count + elapsed timer (PRD 23)", () => {
    renderOverlay(true);
    expect(screen.getByTestId("meeting-count").textContent).toContain("2");
    expect(screen.getByTestId("meeting-timer").textContent).toBe("0:00");
  });

  it("toggles the chat panel closed and badges unread arrivals (PRD 23)", () => {
    renderOverlay(true);
    // Default open.
    expect(screen.getByTestId("meeting-chat")).toBeTruthy();
    // Close it — the panel collapses to a launcher.
    fireEvent.click(screen.getByTestId("meeting-chat-close"));
    expect(screen.queryByTestId("meeting-chat")).toBeNull();
    const launcher = screen.getByTestId("meeting-chat-open");
    expect(launcher).toBeTruthy();
    // A message arriving while closed bumps the unread badge…
    deliverChat("hi there");
    expect(screen.getByTestId("meeting-chat-open").textContent).toContain("1");
    // …and reopening clears it.
    fireEvent.click(screen.getByTestId("meeting-chat-open"));
    expect(screen.getByTestId("meeting-chat")).toBeTruthy();
    expect(screen.queryByTestId("meeting-chat-open")).toBeNull();
  });

  it("surfaces a meeting-chat cooldown notice with retry timing (not a silent drop)", () => {
    renderOverlay(true);
    expect(screen.queryByTestId("meeting-chat-notice")).toBeNull();
    deliverCooldown({ scope: "meeting", retryAfterMs: 4000 });
    expect(screen.getByTestId("meeting-chat-notice").textContent).toBe(
      "You're sending messages too fast — wait 4s.",
    );
  });

  it("ignores a non-meeting cooldown scope (ChatBox owns world/whisper)", () => {
    renderOverlay(true);
    deliverCooldown({ scope: "world", retryAfterMs: 4000 });
    expect(screen.queryByTestId("meeting-chat-notice")).toBeNull();
  });

  it("remembers the closed chat preference for the session", () => {
    renderOverlay(true);
    fireEvent.click(screen.getByTestId("meeting-chat-close"));
    cleanup();
    // A fresh overlay in the same session honours the remembered closed state.
    renderOverlay(true);
    expect(screen.queryByTestId("meeting-chat")).toBeNull();
    expect(screen.getByTestId("meeting-chat-open")).toBeTruthy();
  });
});
