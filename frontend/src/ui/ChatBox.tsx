import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../contract";
import { sharedNet } from "../net/shared";
import { bus } from "../game/eventBus";

export default function ChatBox() {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(true);
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(open);

  useEffect(() => {
    const off = sharedNet().on("chat", (m: ChatMessage) => {
      setMsgs((prev) => [...prev.slice(-50), m]);
      if (m.id !== sharedNet().selfId && !openRef.current)
        setUnread((u) => u + 1);
    });
    return off;
  }, []);

  // Broadcast open/closed so the toast layer knows whether to surface messages.
  useEffect(() => {
    openRef.current = open;
    bus.emit("chat-visibility", { open });
  }, [open]);

  const openPanel = () => {
    setOpen(true);
    setUnread(0);
  };
  const toggle = () => (open ? setOpen(false) : openPanel());

  // A toast (or other UI) can request focus on the chat.
  useEffect(() => {
    const off = bus.on("focus-chat", () => {
      openPanel();
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    return () => {
      off();
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [msgs, open]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    sharedNet().chat(t);
    setText("");
  };

  return (
    <div className={`chatbox ${open ? "" : "collapsed"}`}>
      <div className="chatbox-head" onClick={toggle}>
        <span>
          💬 Chat
          {!open && unread > 0 && (
            <span className="chat-unread">{unread > 9 ? "9+" : unread}</span>
          )}
        </span>
        <span className="chev">{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <>
          <div className="chatbox-list" ref={listRef}>
            {msgs.length === 0 && (
              <div className="chat-empty">Say hi to the space…</div>
            )}
            {msgs.map((m, i) => {
              const me = m.id === sharedNet().selfId;
              return (
                <div key={i} className={`chat-row ${me ? "me" : ""}`}>
                  <div className="chat-bubble">
                    {!me && <b>{m.name}</b>}
                    <span>{m.text}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <form className="chatbox-input" onSubmit={send}>
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message…"
              maxLength={200}
            />
            <button type="submit">Send</button>
          </form>
        </>
      )}
    </div>
  );
}
