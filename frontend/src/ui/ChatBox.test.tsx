import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bus } from "../game/eventBus";
import type { ReportResult } from "../net/reports";

/**
 * Persistent chat-panel test: the net layer is a tiny driveable emitter, so we
 * assert send calls and rendered transcript/collapse/unread state — never Phaser.
 */
const netMock = vi.hoisted(() => {
  const handlers: Record<string, Set<(p: unknown) => void>> = {};
  const net = {
    selfId: "me",
    on: (ev: string, cb: (p: unknown) => void) => {
      const set = (handlers[ev] ??= new Set());
      set.add(cb);
      return () => set.delete(cb);
    },
    emit: (ev: string, p?: unknown) => handlers[ev]?.forEach((cb) => cb(p)),
    chat: vi.fn(),
    whisper: vi.fn(),
  };
  return { handlers, net };
});
vi.mock("../net/shared", () => ({ sharedNet: () => netMock.net }));

const reportMock = vi.hoisted(() => ({
  submitReport: vi.fn<(...args: unknown[]) => Promise<ReportResult>>(),
}));
vi.mock("../net/reports", () => ({ submitReport: reportMock.submitReport }));

import ChatBox from "./ChatBox";

beforeEach(() => {
  netMock.net.chat.mockClear();
  reportMock.submitReport.mockReset();
  reportMock.submitReport.mockResolvedValue({ ok: true, status: "created" });
  for (const k of Object.keys(netMock.handlers)) delete netMock.handlers[k];
});
afterEach(cleanup);

let nextMessageId = 0;
function receiveChat(id: string, name: string, text: string, scope = "world", messageId?: string) {
  const mid = messageId ?? `m-${nextMessageId++}`;
  act(() => netMock.net.emit("chat", { id, name, text, scope, messageId: mid, ts: 1 }));
}

function enterRoom() {
  act(() => bus.emit("room-entered", { roomId: "1" }));
}

/** Submit the chat input's form; throws (no bare `!`) if it isn't mounted. */
function submitChat(value: string) {
  const input = screen.getByLabelText("Chat message");
  fireEvent.change(input, { target: { value } });
  const form = input.closest("form");
  if (!form) throw new Error("chat input is not inside a form");
  fireEvent.submit(form);
}

describe("ChatBox persistent panel", () => {
  it("is always visible with an input, defaulting to the All tab", () => {
    const { container } = render(<ChatBox />);
    expect(container.querySelector(".mc-chat")).toBeTruthy();
    expect(screen.getByLabelText("Chat message")).toBeTruthy();
    expect(screen.getByRole("button", { name: "All" }).className).toContain("active");
  });

  it("sends a plain message on the world channel", () => {
    render(<ChatBox />);
    submitChat("hello world");
    expect(netMock.net.chat).toHaveBeenCalledWith("hello world", "world");
  });

  it("renders received messages in the transcript", () => {
    render(<ChatBox />);
    receiveChat("p2", "bob", "hi there");
    expect(screen.getByText("hi there")).toBeTruthy();
  });

  it("collapses to a slim bar and badges messages received while collapsed", () => {
    render(<ChatBox />);
    fireEvent.click(screen.getByLabelText("Collapse chat"));
    expect(screen.queryByLabelText("Chat message")).toBeNull();
    receiveChat("p2", "bob", "ping");
    receiveChat("p2", "bob", "pong");
    expect(screen.getByLabelText("Open chat, 2 unread")).toBeTruthy();
  });

  it("clears the unread badge when re-expanded", () => {
    render(<ChatBox />);
    fireEvent.click(screen.getByLabelText("Collapse chat"));
    receiveChat("p2", "bob", "ping");
    fireEvent.click(screen.getByLabelText("Open chat, 1 unread"));
    expect(screen.getByLabelText("Chat message")).toBeTruthy();
  });

  it("exposes and auto-selects the Room tab, labeled with the room's registry name, on entry", () => {
    render(<ChatBox />);
    expect(screen.queryByRole("button", { name: /Room/ })).toBeNull();
    enterRoom();
    // Room "1" resolves to its hostel display name via AREA_NAMES (PRD 22).
    const tab = screen.getByRole("button", { name: "Mandakini Hostel · Room 1" });
    expect(tab.className).toContain("active");
  });

  it("routes plain messages to the room channel while on the Room tab", () => {
    render(<ChatBox />);
    enterRoom();
    submitChat("hey room");
    expect(netMock.net.chat).toHaveBeenCalledWith("hey room", "room");
  });

  // PRD 25.16: Tab is intercepted only when a real whisper completion exists.
  function joinPlayers() {
    act(() =>
      netMock.net.emit("init", {
        selfId: "me",
        players: [
          { id: "me", name: "raja" },
          { id: "p2", name: "bob" },
          { id: "p3", name: "bobby" },
        ],
      }),
    );
  }

  it("intercepts Tab to complete a whisper name when a match exists", () => {
    render(<ChatBox />);
    joinPlayers();
    const input = screen.getByLabelText("Chat message");
    fireEvent.change(input, { target: { value: "/w bo" } });
    const ev = fireEvent.keyDown(input, { key: "Tab" });
    // preventDefault was called (event returns false), and the input completed.
    expect(ev).toBe(false);
    expect((input as HTMLInputElement).value).toBe("/w bob");
  });

  it("lets Tab leave chat when no whisper completion applies", () => {
    render(<ChatBox />);
    joinPlayers();
    const input = screen.getByLabelText("Chat message");
    fireEvent.change(input, { target: { value: "hello there" } });
    // Tab is not consumed (default not prevented) so focus can move out of chat.
    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(true);
    expect((input as HTMLInputElement).value).toBe("hello there");
  });

  it("lets Tab leave chat on a whisper prefix that matches no one", () => {
    render(<ChatBox />);
    joinPlayers();
    const input = screen.getByLabelText("Chat message");
    fireEvent.change(input, { target: { value: "/w zzz" } });
    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(true);
    expect((input as HTMLInputElement).value).toBe("/w zzz");
  });

  it("surfaces a world-chat cooldown with retry timing instead of dropping silently", () => {
    render(<ChatBox />);
    act(() => netMock.net.emit("chat-cooldown", { scope: "world", retryAfterMs: 4000 }));
    expect(screen.getByText("You're sending messages too fast — wait 4s.")).toBeTruthy();
  });

  it("surfaces a whisper cooldown in the transcript", () => {
    render(<ChatBox />);
    act(() => netMock.net.emit("chat-cooldown", { scope: "whisper", retryAfterMs: 2500 }));
    expect(screen.getByText("You're sending messages too fast — wait 3s.")).toBeTruthy();
  });

  it("ignores a meeting-scoped cooldown (the meeting panel owns that surface)", () => {
    render(<ChatBox />);
    act(() => netMock.net.emit("chat-cooldown", { scope: "meeting", retryAfterMs: 4000 }));
    expect(screen.queryByText(/sending messages too fast/)).toBeNull();
  });

  it("offers a report affordance on others' messages but not your own (PRD 25.12)", () => {
    render(<ChatBox />);
    receiveChat("me", "you", "my own line");
    receiveChat("p2", "bob", "their line", "world", "m-42");
    expect(screen.queryByRole("button", { name: "Report you's message" })).toBeNull();
    expect(screen.getByRole("button", { name: "Report bob's message" })).toBeTruthy();
  });

  it("reports a message by server messageId and acknowledges the outcome", async () => {
    render(<ChatBox />);
    receiveChat("p2", "bob", "their line", "world", "m-42");
    fireEvent.click(screen.getByRole("button", { name: "Report bob's message" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();
    const form = dialog.querySelector("form");
    if (!form) throw new Error("report dialog has no form");
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(reportMock.submitReport).toHaveBeenCalledWith("m-42", "harassment", undefined);
    await waitFor(() => expect(screen.getByText(/sent to the moderators/i)).toBeTruthy());
    // Dialog closes after a successful report.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
