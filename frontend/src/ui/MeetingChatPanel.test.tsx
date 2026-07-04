import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MeetingChatPanel from "./MeetingChatPanel";
import type { MeetingChatLine } from "../game/meetingChat";

afterEach(cleanup);

function line(over: Partial<MeetingChatLine>): MeetingChatLine {
  return { key: 0, senderId: "p2", name: "Bob", text: "hi", self: false, ...over };
}

describe("MeetingChatPanel", () => {
  it("shows an empty-state hint when there are no lines", () => {
    render(<MeetingChatPanel lines={[]} onSend={() => {}} />);
    expect(screen.getByText(/say hi/i)).toBeTruthy();
  });

  it("renders each line, labelling own messages 'You'", () => {
    render(
      <MeetingChatPanel
        lines={[
          line({ key: 0, name: "Bob", text: "hello", self: false }),
          line({ key: 1, senderId: "me", name: "Me", text: "hey back", self: true }),
        ]}
        onSend={() => {}}
      />,
    );
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText("hey back")).toBeTruthy();
  });

  it("sends trimmed text and clears the input on submit", () => {
    const onSend = vi.fn();
    render(<MeetingChatPanel lines={[]} onSend={onSend} />);
    const input = screen.getByTestId("meeting-chat-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  hello team  " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(onSend).toHaveBeenCalledWith("hello team");
    expect(input.value).toBe("");
  });

  it("does not send when the input is empty or whitespace-only", () => {
    const onSend = vi.fn();
    render(<MeetingChatPanel lines={[]} onSend={onSend} />);
    const input = screen.getByTestId("meeting-chat-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(onSend).not.toHaveBeenCalled();
  });
});
