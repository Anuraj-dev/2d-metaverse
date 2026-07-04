/**
 * In-meeting text chat panel (PRD 10). A thin surface beside the meeting grid:
 * it renders the relayed transcript (see game/meetingChat.ts) and an input that
 * hands typed text to `onSend` (the app shell calls net.meetingChat). All
 * scoping/relay authority is server-side — this component holds no rules.
 *
 * Keyboard events are kept local (stopPropagation): while an input is focused
 * the global ChatBox opener already stands down, and the world scene is asleep,
 * so meeting typing never leaks to game controls.
 */
import { useEffect, useRef, useState } from "react";
import { LIMITS } from "@metaverse/shared";
import type { MeetingChatLine } from "../game/meetingChat";

export interface MeetingChatPanelProps {
  lines: readonly MeetingChatLine[];
  onSend: (text: string) => void;
}

export default function MeetingChatPanel({ lines, onSend }: MeetingChatPanelProps) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the newest line in view as the transcript grows.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  };

  return (
    <section className="meeting-chat" data-testid="meeting-chat" aria-label="Meeting chat">
      <div className="meeting-chat-list" data-testid="meeting-chat-list" ref={listRef}>
        {lines.length === 0 ? (
          <p className="meeting-chat-empty">No messages yet — say hi 👋</p>
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
