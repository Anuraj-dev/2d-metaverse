import { describe, it, expect } from "vitest";
import {
  chatPanelReducer,
  initialChatPanelState,
  type ChatPanelAction,
  type ChatPanelState,
} from "./chatPanel";

/** Fold a script of actions over the reducer from a given start state. */
function run(
  start: ChatPanelState,
  actions: ChatPanelAction[],
): ChatPanelState {
  return actions.reduce(chatPanelReducer, start);
}

describe("chatPanelReducer", () => {
  it("starts expanded on the All tab with no unread and no room", () => {
    expect(initialChatPanelState).toEqual({
      collapsed: false,
      tab: "all",
      roomAvailable: false,
      unread: 0,
    });
  });

  describe("collapse / expand", () => {
    const cases: {
      name: string;
      from: Partial<ChatPanelState>;
      action: ChatPanelAction;
      expect: Partial<ChatPanelState>;
    }[] = [
      { name: "toggle from expanded collapses", from: { collapsed: false }, action: { type: "toggle" }, expect: { collapsed: true } },
      { name: "toggle from collapsed expands", from: { collapsed: true }, action: { type: "toggle" }, expect: { collapsed: false } },
      { name: "collapse when already collapsed is a no-op (same ref)", from: { collapsed: true }, action: { type: "collapse" }, expect: { collapsed: true } },
      { name: "expand when already expanded is a no-op", from: { collapsed: false }, action: { type: "expand" }, expect: { collapsed: false } },
      { name: "expanding clears unread", from: { collapsed: true, unread: 7 }, action: { type: "expand" }, expect: { collapsed: false, unread: 0 } },
      { name: "collapsing preserves the running unread count", from: { collapsed: false, unread: 4 }, action: { type: "collapse" }, expect: { collapsed: true, unread: 4 } },
    ];
    for (const c of cases) {
      it(c.name, () => {
        const start = { ...initialChatPanelState, ...c.from };
        expect(chatPanelReducer(start, c.action)).toMatchObject(c.expect);
      });
    }

    it("no-op collapse returns the same object reference", () => {
      const start = { ...initialChatPanelState, collapsed: true };
      expect(chatPanelReducer(start, { type: "collapse" })).toBe(start);
    });
  });

  describe("unread accrual", () => {
    it("increments unread only while collapsed", () => {
      const collapsed = { ...initialChatPanelState, collapsed: true };
      expect(chatPanelReducer(collapsed, { type: "message" }).unread).toBe(1);
    });

    it("ignores messages while expanded", () => {
      const expanded = { ...initialChatPanelState, collapsed: false, unread: 0 };
      expect(chatPanelReducer(expanded, { type: "message" })).toBe(expanded);
    });

    it("accumulates across many collapsed messages, then clears on expand", () => {
      let s: ChatPanelState = { ...initialChatPanelState, collapsed: true };
      s = run(s, [{ type: "message" }, { type: "message" }, { type: "message" }]);
      expect(s.unread).toBe(3);
      s = chatPanelReducer(s, { type: "expand" });
      expect(s.unread).toBe(0);
    });
  });

  describe("room availability + tabs", () => {
    it("entering a room enables and auto-selects the room tab", () => {
      const s = chatPanelReducer(initialChatPanelState, {
        type: "room-available",
        available: true,
      });
      expect(s).toMatchObject({ roomAvailable: true, tab: "room" });
    });

    it("leaving a room reverts an active room tab to All", () => {
      const inRoom: ChatPanelState = { ...initialChatPanelState, roomAvailable: true, tab: "room" };
      const s = chatPanelReducer(inRoom, { type: "room-available", available: false });
      expect(s).toMatchObject({ roomAvailable: false, tab: "all" });
    });

    it("leaving a room keeps the All tab if it was already active", () => {
      const inRoom: ChatPanelState = { ...initialChatPanelState, roomAvailable: true, tab: "all" };
      const s = chatPanelReducer(inRoom, { type: "room-available", available: false });
      expect(s).toMatchObject({ roomAvailable: false, tab: "all" });
    });

    it("redundant room-available is a no-op (same ref)", () => {
      const inRoom: ChatPanelState = { ...initialChatPanelState, roomAvailable: true, tab: "room" };
      expect(chatPanelReducer(inRoom, { type: "room-available", available: true })).toBe(inRoom);
    });

    it("selecting the room tab while no room is available is ignored", () => {
      expect(chatPanelReducer(initialChatPanelState, { type: "select-tab", tab: "room" })).toBe(
        initialChatPanelState,
      );
    });

    it("selecting the room tab while inside a room switches to it", () => {
      const inRoom: ChatPanelState = { ...initialChatPanelState, roomAvailable: true, tab: "all" };
      expect(chatPanelReducer(inRoom, { type: "select-tab", tab: "room" })).toMatchObject({
        tab: "room",
      });
    });

    it("selecting the already-active tab is a no-op (same ref)", () => {
      expect(chatPanelReducer(initialChatPanelState, { type: "select-tab", tab: "all" })).toBe(
        initialChatPanelState,
      );
    });

    it("can always switch back to All", () => {
      const inRoom: ChatPanelState = { ...initialChatPanelState, roomAvailable: true, tab: "room" };
      expect(chatPanelReducer(inRoom, { type: "select-tab", tab: "all" })).toMatchObject({
        tab: "all",
      });
    });
  });
});
