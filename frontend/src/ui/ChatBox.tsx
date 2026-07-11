import { lazy, Suspense, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Lock, MessageSquare, ChevronDown, Flag } from "lucide-react";
import {
  LIMITS,
  SERVER_EVENTS,
  roomDisplayName,
  type ChatCooldownPayload,
  type ChatMessage,
  type PlayerState,
  type ReportCategory,
} from "@metaverse/shared";
import { sharedNet } from "../net/shared";
import { bus } from "../game/eventBus";
import { chatCooldownNotice } from "../game/chatCooldown";
import { reportResultNotice } from "../game/report";
import { submitReport } from "../net/reports";

const ReportDialog = lazy(() => import("./ReportDialog"));
import {
  chatPanelReducer,
  initialChatPanelState,
  type ChatTab,
} from "../game/chatPanel";

/** A line in the transcript. Whispers and system notices are always shown
 *  regardless of the active channel; world/room chat is filtered by tab. */
type Entry =
  | { kind: "chat"; id: string; name: string; text: string; scope: string; messageId: string }
  | { kind: "wout"; toName: string; text: string }
  | { kind: "win"; fromName: string; text: string }
  | { kind: "sys"; text: string };

/** The message a report dialog is currently open for (PRD 25.12). */
interface ReportTarget {
  messageId: string;
  name: string;
  text: string;
}

interface Player {
  id: string;
  name: string;
}

const MAX_ENTRIES = 120;
const WHISPER_RE = /^\/(?:w|whisper|msg|tell)\s+(\S+)\s+([\s\S]+)$/i;
const WHISPER_NAME_RE = /^(\/(?:w|whisper|msg|tell)\s+)(\S*)$/i;
const REPLY_RE = /^\/r(?:eply)?\s+([\s\S]+)$/i;
const ALL_RE = /^\/all\s+([\s\S]+)$/i;
const ROOM_RE = /^\/room\s+([\s\S]+)$/i;

const HELP: string[] = [
  "Commands:",
  "/w <name> <msg> — whisper a player (Tab completes names)",
  "/r <msg> — reply to your last whisper",
  "/all <msg> — send to the whole world",
  "/room <msg> — send to your private area",
  "/help — show this list",
  "Enter or T focuses chat · Esc returns to the game",
];

function isTypingElsewhere(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable === true
  );
}

/**
 * Persistent, docked chat panel (PRD 20). Always visible bottom-left with All /
 * Room tabs (Room auto-enables on room entry); the transcript no longer fades. The
 * panel collapses to a slim bar with an unread badge. The input is always present:
 * game keys work until it is focused (click, or Enter / T / "/" while playing) and
 * blurring it (Esc, or clicking away) returns keys to the game — the same
 * native-focus gate WorldScene reads. Supports /w whispers with Tab name-completion,
 * /r reply, /all and /room overrides, and /help. All panel state (collapsed / tab /
 * unread / room-availability) lives in the pure `game/chatPanel` reducer.
 */
export default function ChatBox() {
  const [panel, dispatch] = useReducer(chatPanelReducer, initialChatPanelState);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [selfId, setSelfId] = useState(sharedNet().selfId);
  // Registry display name of the room the player is in, shown on the Room tab.
  const [roomName, setRoomName] = useState<string | null>(null);
  // The message a report dialog is open for, or null (PRD 25.12).
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const collapsedRef = useRef(panel.collapsed);
  const roomRef = useRef(panel.roomAvailable);
  const tabRef = useRef(panel.tab);
  const selfIdRef = useRef(selfId);
  const lastWhisper = useRef<{ id: string; name: string } | null>(null);
  const completeRef = useRef<{ base: string; idx: number } | null>(null);

  useEffect(() => {
    collapsedRef.current = panel.collapsed;
  }, [panel.collapsed]);
  useEffect(() => {
    roomRef.current = panel.roomAvailable;
    tabRef.current = panel.tab;
  }, [panel.roomAvailable, panel.tab]);
  useEffect(() => {
    selfIdRef.current = selfId;
  }, [selfId]);

  const push = (e: Entry) =>
    setEntries((prev) => [...prev.slice(-(MAX_ENTRIES - 1)), e]);

  /** Expand the panel (if needed) and focus the input for typing. */
  function focusInput(initial?: string) {
    completeRef.current = null;
    if (initial !== undefined) setText(initial);
    dispatch({ type: "expand" });
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const n = el.value.length;
      el.setSelectionRange(n, n);
    });
  }

  // ---- network + world wiring (mounted once; reads live values via refs) ----
  useEffect(() => {
    const net = sharedNet();
    const offInit = net.on(
      "init",
      (p: { selfId: string; players: PlayerState[] }) => {
        setSelfId(p.selfId);
        setPlayers(p.players.map((x) => ({ id: x.id, name: x.name })));
      }
    );
    const offJoin = net.on("player-joined", (p: PlayerState) =>
      setPlayers((prev) =>
        prev.some((e) => e.id === p.id) ? prev : [...prev, { id: p.id, name: p.name }]
      )
    );
    const offLeft = net.on("player-left", (p: { id: string }) =>
      setPlayers((prev) => prev.filter((e) => e.id !== p.id))
    );

    const offChat = net.on("chat", (m: ChatMessage) => {
      push({ kind: "chat", id: m.id, name: m.name, text: m.text, scope: m.scope, messageId: m.messageId });
      if (m.id !== selfIdRef.current) dispatch({ type: "message" });
    });
    const offWhisper = net.on(
      "whisper",
      (m: { from: string; fromName: string; toName: string; text: string }) => {
        if (m.from === selfIdRef.current) {
          push({ kind: "wout", toName: m.toName, text: m.text });
        } else {
          lastWhisper.current = { id: m.from, name: m.fromName };
          push({ kind: "win", fromName: m.fromName, text: m.text });
          dispatch({ type: "message" });
        }
      }
    );
    const offFail = net.on("whisper-fail", () =>
      push({ kind: "sys", text: "Couldn't deliver your whisper — they may have left." })
    );
    // Anti-spam cooldown (PRD 25.11): the server refused an over-limit send. World
    // and whisper both surface here; the meeting panel owns its own "meeting" line.
    const offCooldown = net.on(
      SERVER_EVENTS.chatCooldown,
      (p: ChatCooldownPayload) => {
        if (p.scope === "meeting") return;
        push({ kind: "sys", text: chatCooldownNotice(p.retryAfterMs) });
      }
    );

    const offEnter = bus.on("room-entered", (p: { roomId: string }) => {
      setRoomName(roomDisplayName(p.roomId));
      dispatch({ type: "room-available", available: true });
    });
    const offLeftRoom = bus.on("room-left", () => {
      setRoomName(null);
      dispatch({ type: "room-available", available: false });
    });
    const offFocus = bus.on("focus-chat", () => focusInput(""));

    return () => {
      offInit();
      offJoin();
      offLeft();
      offChat();
      offWhisper();
      offFail();
      offCooldown();
      offEnter();
      offLeftRoom();
      offFocus();
    };
  }, []);

  // Tell the toast/sound layer whether chat is visible (expanded == "read").
  useEffect(() => {
    bus.emit("chat-visibility", { open: !panel.collapsed });
  }, [panel.collapsed]);

  // keep the transcript pinned to the newest line
  useEffect(() => {
    const el = listRef.current;
    el?.scrollTo?.(0, el.scrollHeight);
  }, [entries, panel.collapsed]);

  // Global hotkeys: focus the input (expanding first) while playing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingElsewhere()) return;
      if (e.key === "Enter" || e.key === "t" || e.key === "T") {
        e.preventDefault();
        focusInput(collapsedRef.current ? "" : undefined);
      } else if (e.key === "/") {
        e.preventDefault();
        focusInput("/");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const resolvePlayer = (name: string): Player | undefined => {
    const lower = name.toLowerCase();
    return (
      players.find((p) => p.id !== selfId && p.name.toLowerCase() === lower) ??
      players.find((p) => p.id !== selfId && p.name.toLowerCase().startsWith(lower))
    );
  };

  const handleSend = (raw: string) => {
    const net = sharedNet();
    const t = raw.trim();
    if (!t) return;

    if (t.startsWith("/")) {
      if (/^\/help\b/i.test(t)) {
        for (const line of HELP) push({ kind: "sys", text: line });
        return;
      }
      const w = t.match(WHISPER_RE);
      if (w) {
        const name = w[1] ?? "";
        const body = w[2] ?? "";
        const target = resolvePlayer(name);
        if (target) net.whisper(target.id, body);
        else push({ kind: "sys", text: `No player named "${name}" is online.` });
        return;
      }
      const r = t.match(REPLY_RE);
      if (r) {
        if (lastWhisper.current) net.whisper(lastWhisper.current.id, r[1] ?? "");
        else push({ kind: "sys", text: "No one to reply to yet." });
        return;
      }
      const a = t.match(ALL_RE);
      if (a) return void net.chat(a[1] ?? "", "world");
      const rm = t.match(ROOM_RE);
      if (rm) {
        if (panel.roomAvailable) net.chat(rm[1] ?? "", "room");
        else push({ kind: "sys", text: "You're not in a private area." });
        return;
      }
      push({ kind: "sys", text: `Unknown command "${t.split(/\s/)[0]}". Try /help.` });
      return;
    }

    // plain message — route by the active channel
    net.chat(t, panel.tab === "room" && panel.roomAvailable ? "room" : "world");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSend(text);
    setText("");
    completeRef.current = null;
  };

  // Tab-completion for whisper targets (cycles through matches).
  const cycleComplete = () => {
    const m = text.match(WHISPER_NAME_RE);
    if (!m) return;
    const prefix = m[1] ?? "";
    const prev = completeRef.current;
    const base = prev?.base ?? m[2] ?? "";
    const matches = players.filter(
      (p) => p.id !== selfId && p.name.toLowerCase().startsWith(base.toLowerCase())
    );
    if (matches.length === 0) return;
    const idx = ((prev?.idx ?? -1) + 1) % matches.length;
    completeRef.current = { base, idx };
    const chosen = matches[idx];
    if (chosen) setText(prefix + chosen.name);
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      inputRef.current?.blur(); // hand movement keys back to the game
    } else if (e.key === "Tab") {
      e.preventDefault();
      cycleComplete();
    }
  };

  // live name suggestions while typing "/w <partial>"
  const suggestions = useMemo(() => {
    const m = text.match(WHISPER_NAME_RE);
    if (!m) return [];
    const token = (m[2] ?? "").toLowerCase();
    return players
      .filter((p) => p.id !== selfId && p.name.toLowerCase().startsWith(token))
      .slice(0, 6);
  }, [text, players, selfId]);

  const visible = useMemo(
    () =>
      entries.filter((e) =>
        e.kind === "chat" ? (panel.tab === "room" ? e.scope !== "world" : true) : true
      ),
    [entries, panel.tab]
  );

  const renderLine = (e: Entry, i: number) => {
    if (e.kind === "win")
      return (
        <div key={i} className="mc-line mc-whisper">
          <span className="mc-arrow">←</span> {e.fromName} whispers: {e.text}
        </div>
      );
    if (e.kind === "wout")
      return (
        <div key={i} className="mc-line mc-whisper">
          <span className="mc-arrow">→</span> You whisper to {e.toName}: {e.text}
        </div>
      );
    if (e.kind === "sys")
      return (
        <div key={i} className="mc-line mc-sys">
          {e.text}
        </div>
      );
    const me = e.id === selfId;
    return (
      <div key={i} className="mc-line">
        <span className={`mc-name ${me ? "me" : ""}`}>&lt;{e.name}&gt;</span>{" "}
        <span className="mc-text">{e.text}</span>
        {!me && (
          <button
            type="button"
            className="mc-report-btn"
            title={`Report ${e.name}'s message`}
            aria-label={`Report ${e.name}'s message`}
            onClick={() =>
              setReportTarget({ messageId: e.messageId, name: e.name, text: e.text })
            }
          >
            <Flag size={12} aria-hidden="true" />
          </button>
        )}
      </div>
    );
  };

  const sendReport = async (target: ReportTarget, category: ReportCategory, note: string) => {
    const result = await submitReport(target.messageId, category, note || undefined);
    setReportTarget(null);
    push({ kind: "sys", text: reportResultNotice(result) });
  };

  const selectTab = (tab: ChatTab) => dispatch({ type: "select-tab", tab });

  if (panel.collapsed) {
    const badge = panel.unread > 99 ? "99+" : String(panel.unread);
    return (
      <button
        type="button"
        className="mc-collapsed"
        onClick={() => dispatch({ type: "expand" })}
        aria-label={
          panel.unread > 0 ? `Open chat, ${panel.unread} unread` : "Open chat"
        }
      >
        <MessageSquare size={15} aria-hidden="true" />
        <span>Chat</span>
        {panel.unread > 0 && <span className="mc-badge">{badge}</span>}
      </button>
    );
  }

  return (
    <div className="mc-chat">
      <div className="mc-tabs">
        <button
          type="button"
          className={panel.tab === "all" ? "active" : ""}
          onClick={() => selectTab("all")}
        >
          All
        </button>
        {panel.roomAvailable && (
          <button
            type="button"
            className={panel.tab === "room" ? "active" : ""}
            onClick={() => selectTab("room")}
            title={roomName ?? "Room"}
          >
            <Lock size={12} aria-hidden="true" /> {roomName ?? "Room"}
          </button>
        )}
        <button
          type="button"
          className="mc-collapse"
          onClick={() => dispatch({ type: "collapse" })}
          aria-label="Collapse chat"
        >
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="mc-list" ref={listRef}>
        {visible.length === 0 ? (
          <div className="mc-empty">
            {panel.tab === "room"
              ? "Private area — only people here see these messages."
              : "Say hi to the space…  (type /help for commands)"}
          </div>
        ) : (
          visible.map(renderLine)
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="mc-suggest">
          {suggestions.map((p) => (
            <button
              key={p.id}
              type="button"
              className="mc-chip"
              onMouseDown={(ev) => {
                ev.preventDefault();
                setText(`/w ${p.name} `);
                completeRef.current = null;
                inputRef.current?.focus();
              }}
            >
              {p.name}
            </button>
          ))}
          <span className="mc-suggest-hint">Tab to complete</span>
        </div>
      )}

      <form className="mc-input" onSubmit={submit}>
        <span className="mc-prompt">
          {panel.tab === "room" ? <Lock size={13} aria-hidden="true" /> : "›"}
        </span>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            completeRef.current = null;
          }}
          onKeyDown={onInputKey}
          maxLength={LIMITS.chatTextMax}
          aria-label="Chat message"
          placeholder={
            panel.tab === "room" ? "Message this area…" : "Message everyone…"
          }
        />
      </form>

      {reportTarget && (
        <Suspense fallback={null}>
          <ReportDialog
            name={reportTarget.name}
            text={reportTarget.text}
            onSubmit={(category, note) => sendReport(reportTarget, category, note)}
            onClose={() => setReportTarget(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
