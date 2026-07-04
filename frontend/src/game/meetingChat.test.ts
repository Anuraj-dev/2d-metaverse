import { describe, expect, it } from "vitest";
import type { MeetingChatMessage } from "@metaverse/shared";
import {
  EMPTY_MEETING_CHAT,
  MEETING_CHAT_MAX_LINES,
  appendMeetingChat,
  type MeetingChatState,
} from "./meetingChat";

const SELF = "me";

function msg(over: Partial<MeetingChatMessage> = {}): MeetingChatMessage {
  return { roomId: "1", id: "other", name: "Bob", text: "hi", ...over };
}

describe("appendMeetingChat", () => {
  it("appends a line with a monotonic key and the sender's name", () => {
    const next = appendMeetingChat(EMPTY_MEETING_CHAT, msg({ text: "hello" }), SELF);
    expect(next.lines).toEqual([{ key: 0, senderId: "other", name: "Bob", text: "hello", self: false }]);
    expect(next.nextKey).toBe(1);
  });

  it("flags the local player's own lines via the sender id", () => {
    const next = appendMeetingChat(EMPTY_MEETING_CHAT, msg({ id: SELF, name: "Me", text: "yo" }), SELF);
    expect(next.lines[0]?.self).toBe(true);
  });

  it("assigns distinct, increasing keys across appends", () => {
    const one = appendMeetingChat(EMPTY_MEETING_CHAT, msg({ text: "a" }), SELF);
    const two = appendMeetingChat(one, msg({ text: "b" }), SELF);
    expect(two.lines.map((line) => line.key)).toEqual([0, 1]);
    expect(two.lines.map((line) => line.text)).toEqual(["a", "b"]);
    expect(two.nextKey).toBe(2);
  });

  it("does not mutate the previous state", () => {
    const one = appendMeetingChat(EMPTY_MEETING_CHAT, msg(), SELF);
    appendMeetingChat(one, msg({ text: "again" }), SELF);
    expect(one.lines).toHaveLength(1);
    expect(EMPTY_MEETING_CHAT.lines).toHaveLength(0);
  });

  it("caps the transcript at MEETING_CHAT_MAX_LINES, dropping the oldest", () => {
    let state: MeetingChatState = EMPTY_MEETING_CHAT;
    const total = MEETING_CHAT_MAX_LINES + 5;
    for (let i = 0; i < total; i += 1) state = appendMeetingChat(state, msg({ text: `m${i}` }), SELF);
    expect(state.lines).toHaveLength(MEETING_CHAT_MAX_LINES);
    // Oldest five fell off; keys keep climbing (stable across the drop).
    expect(state.lines[0]?.text).toBe("m5");
    expect(state.lines[0]?.key).toBe(5);
    expect(state.lines.at(-1)?.text).toBe(`m${total - 1}`);
    expect(state.nextKey).toBe(total);
  });
});
