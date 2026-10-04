/**
 * In-meeting text chat panel (PRD 10 + 23). A thin surface beside the meeting
 * grid: it renders the relayed transcript (see game/meetingChat.ts) and an input
 * that hands typed text to `onSend` (the app shell calls net.meetingChat). All
 * scoping/relay authority is server-side — this component holds no rules.
 *
 * Open/close (PRD 23): the panel collapses to a slim launcher that shows an
 * unread badge; the open/unread state is owned by the meeting-chat reducer and
 * remembered for the session by the overlay. Reclaiming the space is opt-in.
 *
 * Keyboard events are kept local (stopPropagation): while an input is focused
 * the global ChatBox opener already stands down, and the world scene is asleep,
 * so meeting typing never leaks to game controls.
 */
import { useEffect, useRef, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { LIMITS } from "@metaverse/shared";
import type { MeetingChatLine } from "../game/meetingChat";

export interface MeetingChatPanelProps {
  lines: readonly MeetingChatLine[];
  onSend: (text: string) => void;
  /** Whether the panel is expanded (PRD 23). */
  open: boolean;
  /** Unread count shown on the launcher while closed. */
  unread: number;
  /** Toggle open/closed. */
  onToggle: () => void;
  /** Transient anti-spam cooldown notice (PRD 25.11); null when none. */
  notice?: string | null;
}

export default function MeetingChatPanel({ lines, onSend, open, unread, onToggle, notice = null }: MeetingChatPanelProps) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const [following, setFollowing] = useState(true);
  const [readThrough, setReadThrough] = useState<number | undefined>(undefined);
  const latestKey = lines.at(-1)?.key;
  const hasNewMessages = !following && latestKey !== readThrough;
  const toggle = () => {
    followLatest.current = true;
    setFollowing(true);
    setReadThrough(latestKey);
    onToggle();
  };

  // Follow new messages only while reading the latest; reopening starts there.
  useEffect(() => {
    if (!open) {
      followLatest.current = true;
      return;
    }
    const el = listRef.current;
    if (el && followLatest.current) el.scrollTop = el.scrollHeight;
  }, [lines, open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  };

  if (!open) {
    const badge = unread > 99 ? "99+" : String(unread);
    return (
      <button
        type="button"
        className="meeting-chat-launcher"
        data-testid="meeting-chat-open"
        onClick={toggle}
        aria-label={unread > 0 ? `Open meeting chat, ${unread} unread` : "Open meeting chat"}
      >
        <MessageSquare size={18} aria-hidden="true" />
        {unread > 0 && <span className="meeting-chat-badge">{badge}</span>}
      </button>
    );
  }

  return (
    <section className="meeting-chat" data-testid="meeting-chat" aria-label="Meeting chat">
      <header className="meeting-chat-head">
        <span className="meeting-chat-head-title">Chat</span>
        <button
          type="button"
          className="meeting-chat-close"
          onClick={toggle}
          aria-label="Close meeting chat"
          data-testid="meeting-chat-close"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div
        className="meeting-chat-list"
        data-testid="meeting-chat-list"
        ref={listRef}
        role="log"
        aria-label="Meeting messages"
        aria-live="polite"
        aria-relevant="additions"
        tabIndex={0}
        onScroll={(event) => {
          const list = event.currentTarget;
          const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= 24;
          if (followLatest.current || atBottom) setReadThrough(latestKey);
          followLatest.current = atBottom;
          setFollowing(followLatest.current);
        }}
      >
        {lines.length === 0 ? (
          <p className="meeting-chat-empty">No messages yet. Say hi</p>
        ) : (
          lines.map((line) => (
            <p key={line.key} className={`meeting-chat-line${line.self ? " self" : ""}`}>
              <span className="meeting-chat-name">{line.self ? "You" : line.name}</span>
              <span className="meeting-chat-text">{line.text}</span>
            </p>
          ))
        )}
      </div>
      {hasNewMessages && (
        <button
          type="button"
          className="meeting-chat-latest"
          onClick={() => {
            const list = listRef.current;
            if (list) list.scrollTop = list.scrollHeight;
            followLatest.current = true;
            setFollowing(true);
            setReadThrough(latestKey);
          }}
        >
          New messages · Jump to latest
        </button>
      )}
      {notice && (
        <p className="meeting-chat-notice" role="status" data-testid="meeting-chat-notice">
          {notice}
        </p>
      )}
      <form className="meeting-chat-input" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          autoComplete="off"
          maxLength={LIMITS.chatTextMax}
          placeholder="Message the meeting…"
          aria-label="Message the meeting"
          data-testid="meeting-chat-input"
        />
        <button type="submit" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
