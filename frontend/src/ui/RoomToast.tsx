import { useEffect, useState } from "react";
import { DoorOpen } from "lucide-react";
import { roomDisplayName } from "@metaverse/shared";
import { bus } from "../game/eventBus";

/**
 * A brief "you're now in <room>" toast shown on room entry (PRD 22). The scene
 * emits `room-entered`{roomId} when the server admits this client; we resolve
 * the id to its registry display name (e.g. "Cauvery Hostel · Room 4") so the
 * player always knows exactly where they are. Purely presentational — all
 * frontend, no net.
 */
export default function RoomToast() {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (roomId: string) => {
      setName(roomDisplayName(roomId));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setName(null), 3200);
    };
    const offEntered = bus.on("room-entered", (p: { roomId: string }) => show(p.roomId));
    const offLeft = bus.on("room-left", () => {
      if (timer) clearTimeout(timer);
      setName(null);
    });
    return () => {
      offEntered();
      offLeft();
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!name) return null;
  return (
    <div className="room-toast" role="status">
      <DoorOpen size={18} aria-hidden="true" />
      <span>
        Entered <strong>{name}</strong>
      </span>
    </div>
  );
}
