/**
 * Pure state machine for the persistent chat panel HUD (PRD 20). Plain values in,
 * plain values out — no React / DOM / net imports. `ChatBox` is glue that maps DOM
 * and bus events onto these actions and renders the returned state.
 *
 * Model: the panel is always mounted. It is either collapsed to a slim bar (which
 * shows an unread badge counting messages that arrived while collapsed) or expanded
 * (which shows the transcript + input and counts as "read"). Two channel tabs —
 * `all` (the world channel) and `room` (the private area you're currently inside) —
 * with the room tab available only while inside a room and auto-selected on entry,
 * mirroring the pre-overhaul behaviour. Selecting an unavailable room tab is a no-op.
 */
export type ChatTab = "all" | "room";

export interface ChatPanelState {
  /** Slim-bar mode: transcript + input hidden, unread badge shown. */
  readonly collapsed: boolean;
  /** Active channel tab. */
  readonly tab: ChatTab;
  /** Whether the player is inside a room (enables/selects the room tab). */
  readonly roomAvailable: boolean;
  /** Messages seen while collapsed; reset to 0 whenever the panel expands. */
  readonly unread: number;
}

export const initialChatPanelState: ChatPanelState = {
  collapsed: false,
  tab: "all",
  roomAvailable: false,
  unread: 0,
};

export type ChatPanelAction =
  | { type: "toggle" }
  | { type: "expand" }
  | { type: "collapse" }
  | { type: "select-tab"; tab: ChatTab }
  | { type: "room-available"; available: boolean }
  | { type: "message" };

export function chatPanelReducer(
  state: ChatPanelState,
  action: ChatPanelAction,
): ChatPanelState {
  switch (action.type) {
    case "toggle":
      return setCollapsed(state, !state.collapsed);
    case "expand":
      return setCollapsed(state, false);
    case "collapse":
      return setCollapsed(state, true);
    case "select-tab": {
      // The room tab can only be selected while a room is available.
      if (action.tab === "room" && !state.roomAvailable) return state;
      if (action.tab === state.tab) return state;
      return { ...state, tab: action.tab };
    }
    case "room-available": {
      if (action.available === state.roomAvailable) return state;
      if (action.available) {
        // Entering a room auto-selects its channel, as before the overhaul.
        return { ...state, roomAvailable: true, tab: "room" };
      }
      // Leaving a room drops back to All if the room tab was active.
      return {
        ...state,
        roomAvailable: false,
        tab: state.tab === "room" ? "all" : state.tab,
      };
    }
    case "message":
      // Only accrue unread while collapsed; an expanded panel is already read.
      if (!state.collapsed) return state;
      return { ...state, unread: state.unread + 1 };
  }
}

function setCollapsed(state: ChatPanelState, collapsed: boolean): ChatPanelState {
  if (collapsed === state.collapsed) return state;
  // Expanding marks everything read; collapsing preserves the running count.
  return { ...state, collapsed, unread: collapsed ? state.unread : 0 };
}
