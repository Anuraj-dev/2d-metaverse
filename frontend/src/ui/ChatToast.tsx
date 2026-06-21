import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../contract";
import { sharedNet } from "../net/shared";
import { bus } from "../game/eventBus";
import { playSfx, preloadSfx } from "../media/sfx";
import { getSettings } from "./settings";

interface Toast {
  key: number;
  name: string;
  text: string;
}

/**
 * Surfaces incoming chat you'd otherwise miss: a slide-in toast (when the chat
 * panel is closed or the tab is hidden), a notification chime, and a tab-title
 * flash + optional Web Notification while the tab is unfocused. All frontend.
 */
export default function ChatToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const chatOpenRef = useRef(true);
  const hiddenUnreadRef = useRef(0);
  const baseTitleRef = useRef(document.title);
  const seq = useRef(0);

  useEffect(() => {
    preloadSfx();
    baseTitleRef.current = document.title;

    const restoreTitle = () => {
      hiddenUnreadRef.current = 0;
      document.title = baseTitleRef.current;
    };
    const onVisibility = () => {
      if (!document.hidden) restoreTitle();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const offVis = bus.on("chat-visibility", (p: { open: boolean }) => {
      chatOpenRef.current = p.open;
    });

    const offChat = sharedNet().on("chat", (m: ChatMessage) => {
      if (m.id === sharedNet().selfId) return;
      const hidden = document.hidden;
      const surface = !chatOpenRef.current || hidden;
      if (!surface) return;

      playSfx("message", { notify: true });

      const key = seq.current++;
      setToasts((prev) => [...prev.slice(-2), { key, name: m.name, text: m.text }]);
      window.setTimeout(
        () => setToasts((prev) => prev.filter((t) => t.key !== key)),
        4000
      );

      if (hidden && getSettings().tabFlash) {
        hiddenUnreadRef.current += 1;
        document.title = `(${hiddenUnreadRef.current}) New message…`;
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            new Notification(`${m.name}`, { body: m.text, silent: true });
          } catch {
            /* ignore */
          }
        }
      }
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      restoreTitle();
      offVis();
      offChat();
    };
  }, []);

  const openChat = (key: number) => {
    setToasts((prev) => prev.filter((t) => t.key !== key));
    bus.emit("focus-chat");
  };

  if (toasts.length === 0) return null;
  return (
    <div className="chat-toasts">
      {toasts.map((t) => (
        <button key={t.key} className="chat-toast" onClick={() => openChat(t.key)}>
          <span className="chat-toast-name">{t.name}</span>
          <span className="chat-toast-text">{t.text}</span>
        </button>
      ))}
    </div>
  );
}
