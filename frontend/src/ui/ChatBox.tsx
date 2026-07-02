import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, PlayerState } from "../contract";
import { sharedNet } from "../net/shared";
import { bus } from "../game/eventBus";

/** A line in the transcript. Whispers and system notices are always shown
 *  regardless of the active channel; world/room chat is filtered by tab. */
type Entry =
  | { kind: "chat"; id: string; name: string; text: string; scope: string }
  | { kind: "wout"; toName: string; text: string }
  | { kind: "win"; fromName: string; text: string }
  | { kind: "sys"; text: string };

interface Player {
  id: string;
  name: string;
}

const MAX_ENTRIES = 120;
const LOG_LINES = 10;
const FADE_MS = 5000;
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
  "Enter or T opens chat · Esc closes",
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
 * Minecraft-style chat. The input is hidden during play and opens on Enter / T
 * (empty) or "/" (a command). When closed, a faded transcript of recent lines
 * floats bottom-left and fades after a few seconds. An All / 🔒 Private filter
 * appears inside a private area (auto-selected on entry). Supports /w whispers
 * with Tab name-completion, /r reply, /all and /room overrides, and /help.
 */
export default function ChatBox() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "private">("all");
  const [inPrivate, setInPrivate] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selfId, setSelfId] = useState(sharedNet().selfId);
  const [faded, setFaded] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  const selfIdRef = useRef(selfId);
  const lastWhisper = useRef<{ id: string; name: string } | null>(null);
  const completeRef = useRef<{ base: string; idx: number } | null>(null);
  const fadeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    selfIdRef.current = selfId;
  }, [selfId]);

  const push = (e: Entry) => {
    setEntries((prev) => [...prev.slice(-(MAX_ENTRIES - 1)), e]);
    setFaded(false);
    window.clearTimeout(fadeTimer.current);
    if (!openRef.current)
      fadeTimer.current = window.setTimeout(() => setFaded(true), FADE_MS);
  };

  function openInput(initial: string) {
    completeRef.current = null;
    setText(initial);
    setOpen(true);
    setFaded(false);
    window.clearTimeout(fadeTimer.current);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const n = el.value.length;
      el.setSelectionRange(n, n);
    });
  }

  function closeInput() {
    setOpen(false);
    setText("");
    completeRef.current = null;
    inputRef.current?.blur();
    fadeTimer.current = window.setTimeout(() => setFaded(true), FADE_MS);
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

    const offChat = net.on("chat", (m: ChatMessage) =>
      push({ kind: "chat", id: m.id, name: m.name, text: m.text, scope: m.scope })
    );
    const offWhisper = net.on(
      "whisper",
      (m: { from: string; fromName: string; toName: string; text: string }) => {
        if (m.from === selfIdRef.current) {
          push({ kind: "wout", toName: m.toName, text: m.text });
        } else {
          lastWhisper.current = { id: m.from, name: m.fromName };
          push({ kind: "win", fromName: m.fromName, text: m.text });
        }
      }
    );
    const offFail = net.on("whisper-fail", () =>
      push({ kind: "sys", text: "Couldn't deliver your whisper — they may have left." })
    );

    const offEnter = bus.on("room-entered", () => {
      setInPrivate(true);
      setTab("private");
    });
    const offLeftRoom = bus.on("room-left", () => {
      setInPrivate(false);
      setTab("all");
    });
    const offFocus = bus.on("focus-chat", () => openInput(""));

    return () => {
      offInit();
      offJoin();
      offLeft();
      offChat();
      offWhisper();
      offFail();
      offEnter();
      offLeftRoom();
      offFocus();
      window.clearTimeout(fadeTimer.current);
    };
  }, []);

  // Tell the toast/sound layer whether the input is up.
  useEffect(() => {
    bus.emit("chat-visibility", { open });
  }, [open]);

  // keep the transcript pinned to the newest line
  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [entries, open]);

  // Global hotkeys to OPEN the input while playing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (openRef.current || isTypingElsewhere()) return;
      if (e.key === "Enter" || e.key === "t" || e.key === "T") {
        e.preventDefault();
        openInput("");
      } else if (e.key === "/") {
        e.preventDefault();
        openInput("/");
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
        if (inPrivate) net.chat(rm[1] ?? "", "room");
        else push({ kind: "sys", text: "You're not in a private area." });
        return;
      }
      push({ kind: "sys", text: `Unknown command "${t.split(/\s/)[0]}". Try /help.` });
      return;
    }

    // plain message — route by the active channel
    net.chat(t, tab === "private" && inPrivate ? "room" : "world");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSend(text);
    closeInput();
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
      closeInput();
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
        e.kind === "chat" ? (tab === "private" ? e.scope !== "world" : true) : true
      ),
    [entries, tab]
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
      </div>
    );
  };

  return (
    <>
      {!open && visible.length > 0 && (
        <div className={`mc-log ${faded ? "faded" : ""}`} aria-hidden="true">
          {visible.slice(-LOG_LINES).map(renderLine)}
        </div>
      )}

      {open && (
        <div className="mc-chat">
          <div className="mc-tabs">
            <button
              type="button"
              className={tab === "all" ? "active" : ""}
              onClick={() => setTab("all")}
            >
              All
            </button>
            {inPrivate && (
              <button
                type="button"
                className={tab === "private" ? "active" : ""}
                onClick={() => setTab("private")}
              >
                🔒 Private
              </button>
            )}
          </div>

          <div className="mc-list" ref={listRef}>
            {visible.length === 0 ? (
              <div className="mc-empty">
                {tab === "private"
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
            <span className="mc-prompt">{tab === "private" ? "🔒" : "›"}</span>
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                completeRef.current = null;
              }}
              onKeyDown={onInputKey}
              maxLength={256}
              placeholder={
                tab === "private" ? "Message this area…" : "Message everyone…"
              }
            />
          </form>
        </div>
      )}
    </>
  );
}
