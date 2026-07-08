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
}

export default function MeetingChatPanel({ lines, onSend, open, unread, onToggle }: MeetingChatPanelProps) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the newest line in view as the transcript grows (only while open).
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, open]);

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
        onClick={onToggle}
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
          onClick={onToggle}
          aria-label="Close meeting chat"
          data-testid="meeting-chat-close"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="meeting-chat-list" data-testid="meeting-chat-list" ref={listRef}>
        {lines.length === 0 ? (
          <p className="meeting-chat-empty">No messages yet — say hi</p>
        ) : (
          lines.map((line) => (
            <p key={line.key} className={`meeting-chat-line${line.self ? " self" : ""}`}>
              <span className="meeting-chat-name">{line.self ? "You" : line.name}</span>
              <span className="meeting-chat-text">{line.text}</span>
            </p>
          ))
        )}
      </div>
      <form className="meeting-chat-input" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
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
