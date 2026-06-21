import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../contract";
import { sharedNet } from "../net/shared";

export default function ChatBox() {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const off = sharedNet().on("chat", (m: ChatMessage) =>
      setMsgs((prev) => [...prev.slice(-50), m])
    );
    return off;
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [msgs]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    sharedNet().chat(t);
    setText("");
  };

  return (
    <div className={`chatbox ${open ? "" : "collapsed"}`}>
      <div className="chatbox-head" onClick={() => setOpen((o) => !o)}>
        <span>💬 Chat</span>
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
