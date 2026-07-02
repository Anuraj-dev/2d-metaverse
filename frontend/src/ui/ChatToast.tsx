import { useEffect, useRef } from "react";
import type { ChatMessage } from "@metaverse/shared";
import { sharedNet } from "../net/shared";
import { bus } from "../game/eventBus";
import { playSfx, preloadSfx } from "../media/sfx";
import { getSettings } from "./settings";

/**
 * Audio + attention cues for incoming chat you'd otherwise miss. The visible
 * transcript is owned by ChatBox's faded log; this only plays a chime when the
 * input is closed or the tab is hidden, and flashes the tab title + fires a
 * Web Notification while the tab is unfocused. All frontend.
 */
export default function ChatToast() {
  const chatOpenRef = useRef(false);
  const hiddenUnreadRef = useRef(0);
  const baseTitleRef = useRef(document.title);

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
      if (!chatOpenRef.current || hidden) playSfx("message", { notify: true });

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

  return null;
}
