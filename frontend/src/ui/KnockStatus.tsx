import { useEffect, useState } from "react";
import { DoorClosed, Hand } from "lucide-react";
import { bus } from "../game/eventBus";
import { sharedNet } from "../net/shared";
import { CAPACITY_MESSAGE, knockResultMessage } from "../game/roomAccess";

/**
 * The knocking-requester UI (PRD 14): a small cancelable "Knocking…" card while
 * a knock is pending at a door, plus brief feedback when a knock is denied,
 * times out, or the room is full. The scene (WorldScene) drives it via the
 * `knocking` / `stop-knocking` bus events; results come straight off the net.
 */
export default function KnockStatus() {
  const [knock, setKnock] = useState<{ roomId: string; name: string } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const net = sharedNet();
    let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
    const showFeedback = (message: string) => {
      setKnock(null);
      setFeedback(message);
      if (feedbackTimer) clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => setFeedback(null), 3000);
    };

    const offKnocking = bus.on("knocking", (p: { roomId: string; name: string }) => {
      setFeedback(null);
      setKnock(p);
    });
    const offStop = bus.on("stop-knocking", () => setKnock(null));
    const offResult = net.on("knock-result", (p: { result: "approved" | "denied" | "timeout" }) => {
      if (p.result === "approved") {
        setKnock(null);
        bus.emit("knock-approved");
      } else {
        showFeedback(knockResultMessage(p.result));
        bus.emit("knock-denied");
      }
    });
    const offCapacity = net.on("capacity-alert", () => showFeedback(CAPACITY_MESSAGE));

    return () => {
      offKnocking();
      offStop();
      offResult();
      offCapacity();
      if (feedbackTimer) clearTimeout(feedbackTimer);
    };
  }, []);

  const cancel = () => {
    if (knock) sharedNet().cancelKnock(knock.roomId);
    setKnock(null);
  };

  if (knock) {
    return (
      <div className="knock-status" role="status" data-dialog-keep-live>
        <span className="knock-spinner" aria-hidden="true"><Hand size={20} /></span>
        <div className="knock-text">
          <strong>Knocking…</strong>
          <span>Waiting for the admin of {knock.name}</span>
        </div>
        <button type="button" className="ghost" onClick={cancel}>
          Cancel
        </button>
      </div>
    );
  }
  if (feedback) {
    return (
      <div className="knock-status knock-status-feedback" role="status" data-dialog-keep-live>
        <span className="knock-status-icon" aria-hidden="true"><DoorClosed size={18} /></span>
        <div className="knock-text">{feedback}</div>
      </div>
    );
  }
  return null;
}
