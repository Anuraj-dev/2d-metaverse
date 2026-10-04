import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LIMITS } from "@metaverse/shared";
import MeetingChatPanel from "./MeetingChatPanel";
import type { MeetingChatLine } from "../game/meetingChat";

afterEach(cleanup);

function line(over: Partial<MeetingChatLine>): MeetingChatLine {
  return { key: 0, senderId: "p2", name: "Bob", text: "hi", self: false, ...over };
}

/** Render the panel open by default (PRD 23 open/unread props). */
function renderPanel(
  over: Partial<React.ComponentProps<typeof MeetingChatPanel>> = {},
) {
  const props = { lines: [], onSend: () => {}, open: true, unread: 0, onToggle: () => {}, ...over };
  return render(<MeetingChatPanel {...props} />);
}

describe("MeetingChatPanel", () => {
  it("shows an empty-state hint when there are no lines", () => {
    renderPanel();
    expect(screen.getByText(/say hi/i)).toBeTruthy();
  });

  it("renders each line, labelling own messages 'You'", () => {
    renderPanel({
      lines: [
        line({ key: 0, name: "Bob", text: "hello", self: false }),
        line({ key: 1, senderId: "me", name: "Me", text: "hey back", self: true }),
      ],
    });
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText("hey back")).toBeTruthy();
  });

  it("sends trimmed text and clears the input on submit", () => {
    const onSend = vi.fn();
    renderPanel({ onSend });
    const input = screen.getByTestId("meeting-chat-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  hello team  " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(onSend).toHaveBeenCalledWith("hello team");
    expect(input.value).toBe("");
  });

  it("does not send when the input is empty or whitespace-only", () => {
    const onSend = vi.fn();
    renderPanel({ onSend });
    const input = screen.getByTestId("meeting-chat-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("collapses to a launcher with an unread badge when closed (PRD 23)", () => {
    const onToggle = vi.fn();
    renderPanel({ open: false, unread: 3, onToggle });
    // The transcript is hidden; the launcher shows the unread count.
    expect(screen.queryByTestId("meeting-chat-list")).toBeNull();
    const launcher = screen.getByTestId("meeting-chat-open");
    expect(launcher.textContent).toContain("3");
    fireEvent.click(launcher);
    expect(onToggle).toHaveBeenCalled();
  });

  it("closes via the header control (PRD 23)", () => {
    const onToggle = vi.fn();
    renderPanel({ open: true, onToggle });
    fireEvent.click(screen.getByTestId("meeting-chat-close"));
    expect(onToggle).toHaveBeenCalled();
  });

  it("keeps reading position while scrolled up, then follows new messages at the bottom", () => {
    const props = { lines: [line({ key: 0 })], onSend: vi.fn(), open: true, unread: 0, onToggle: vi.fn() };
    const { rerender } = render(<MeetingChatPanel {...props} />);
    const list = screen.getByRole("log", { name: "Meeting messages" });
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 200 },
    });
    list.scrollTop = 100;
    fireEvent.scroll(list);
    rerender(<MeetingChatPanel {...props} lines={[line({ key: 1, text: "New message while reading" })]} />);
    expect(list.scrollTop).toBe(100);
    expect(screen.getByRole("button", { name: /jump to latest/i })).toBeTruthy();
    list.scrollTop = 120;
    fireEvent.scroll(list);
    expect(screen.getByRole("button", { name: /jump to latest/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /jump to latest/i }));
    expect(list.scrollTop).toBe(600);
    expect(screen.queryByRole("button", { name: /jump to latest/i })).toBeNull();

    list.scrollTop = 400;
    fireEvent.scroll(list);
    // A capped transcript replaces lines without changing its length.
    rerender(<MeetingChatPanel {...props} lines={[line({ key: 2, text: "Latest message" })]} />);
    expect(list.scrollTop).toBe(600);
  });

  it("keeps meeting typing local and enforces the shared message limit", () => {
    const onKey = vi.fn();
    render(<div onKeyDown={onKey}><MeetingChatPanel lines={[]} onSend={vi.fn()} open unread={0} onToggle={vi.fn()} /></div>);
    const input = screen.getByRole("textbox", { name: "Message the meeting" });
    fireEvent.keyDown(input, { key: "t" });
    expect(onKey).not.toHaveBeenCalled();
    expect(input.getAttribute("maxlength")).toBe(String(LIMITS.chatTextMax));
  });

  it("clears the new-message prompt when closing and reopening chat", () => {
    const props = { lines: [line({ key: 0 })], onSend: vi.fn(), open: true, unread: 0, onToggle: vi.fn() };
    const { rerender } = render(<MeetingChatPanel {...props} />);
    const list = screen.getByRole("log", { name: "Meeting messages" });
    Object.defineProperties(list, { scrollHeight: { value: 600 }, clientHeight: { value: 200 } });
    list.scrollTop = 100;
    fireEvent.scroll(list);
    const lines = [line({ key: 1 })];
    rerender(<MeetingChatPanel {...props} lines={lines} />);
    expect(screen.getByRole("button", { name: /jump to latest/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close meeting chat" }));
    rerender(<MeetingChatPanel {...props} lines={lines} open={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Open meeting chat" }));
    rerender(<MeetingChatPanel {...props} lines={lines} />);
    expect(screen.queryByRole("button", { name: /jump to latest/i })).toBeNull();
  });
});
