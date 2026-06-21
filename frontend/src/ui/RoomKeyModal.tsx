import { useEffect, useState } from "react";
import { bus } from "../game/eventBus";
import { sharedNet } from "../net/shared";
import { MOCK_ROOM_KEYS } from "../net/net";
import { roomEnterErrorMessage } from "./roomEnter";

export default function RoomKeyModal() {
  const [room, setRoom] = useState<{ roomId: string; name: string } | null>(
    null
  );
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const offNear = bus.on("near-door", (p: { roomId: string; name: string }) => {
      setRoom(p);
      setKey("");
      setError(null);
    });
    const offLeave = bus.on("leave-door", () => setRoom(null));
    const offResult = sharedNet().on(
      "room-enter-result",
      (p: { ok: boolean; roomId: string; reason?: string }) => {
        if (p.ok) {
          bus.emit("room-entered", { roomId: p.roomId });
          setRoom(null);
        } else {
          setError(roomEnterErrorMessage(p.reason));
        }
      }
    );
    return () => {
      offNear();
      offLeave();
      offResult();
    };
  }, []);

  if (!room) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    sharedNet().enterRoom(room.roomId, key.trim());
  };

  return (
    <div className="modal-backdrop">
      <form className="key-modal" onSubmit={submit}>
        <div className="key-icon">🔒</div>
        <h3>{room.name}</h3>
        <p>Enter the room key to join.</p>
        <input
          autoFocus
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Room key"
        />
        {error && <div className="key-error">{error}</div>}
        <div className="key-actions">
          <button type="button" className="ghost" onClick={() => setRoom(null)}>
            Cancel
          </button>
          <button type="submit">Enter</button>
        </div>
        {import.meta.env.DEV && (
          <div className="key-hint">
            dev keys — Room {room.roomId}: <code>{MOCK_ROOM_KEYS[room.roomId]}</code>
          </div>
        )}
      </form>
    </div>
  );
}
