import { useEffect, useState } from "react";
import type { PlayerState } from "@metaverse/shared";
import { bus } from "../game/eventBus";
import { sharedNet } from "../net/shared";
import { adminPanelView, type AdminRef, type Requester, type RoomOpenState } from "../game/roomAccess";

/**
 * In-room admin HUD (PRD 14): shows who the admin is, and — to the admin only —
 * an allow-all toggle and Google-Meet-style approve/deny prompts for pending
 * knockers. All state comes from authoritative server events; the pure
 * `adminPanelView` decides what to render.
 */
export default function RoomAdminPanel() {
  const [selfId, setSelfId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [admin, setAdmin] = useState<AdminRef | null>(null);
  const [open, setOpen] = useState<RoomOpenState | undefined>(undefined);
  const [pending, setPending] = useState<Requester[]>([]);

  useEffect(() => {
    const net = sharedNet();
    setSelfId(net.selfId || null);
    const offInit = net.on("init", (p: { selfId: string; players: PlayerState[] }) => setSelfId(p.selfId));

    // Entering / leaving a room scopes the panel and clears stale state.
    const offEntered = bus.on("room-entered", (p: { roomId: string }) => setRoomId(p.roomId));
    const offLeft = bus.on("room-left", () => {
      setRoomId(null);
      setAdmin(null);
      setOpen(undefined);
      setPending([]);
    });

    const offAdmin = net.on(
      "admin-changed",
      (p: { roomId: string; admin: AdminRef | null; reason: "initial" | "succession" }) => {
        setAdmin(p.admin);
        // "You are now the admin" cue on a hand-off (not the initial self-grant).
        if (p.reason === "succession" && p.admin && p.admin.id === net.selfId) bus.emit("admin-promoted");
      },
    );
    const offOpen = net.on(
      "room-open-state",
      (p: { roomId: string; allowAll: boolean; atCapacity: boolean }) =>
        setOpen({ allowAll: p.allowAll, atCapacity: p.atCapacity }),
    );
    const offPending = net.on(
      "knock-pending",
      (p: { roomId: string; knocks: Requester[] }) => {
        // A newly-arrived knocker rings the admin's incoming-knock cue.
        setPending((prev) => {
          if (p.knocks.length > prev.length) bus.emit("knock-received");
          return p.knocks;
        });
      },
    );

    return () => {
      offInit();
      offEntered();
      offLeft();
      offAdmin();
      offOpen();
      offPending();
    };
  }, []);

  if (!roomId) return null;
  const view = adminPanelView({ selfId, admin, open, pending });
  if (!view.badge && !view.showToggle) return null;

  const net = sharedNet();
  return (
    <div className="room-admin">
      <div className="room-admin-bar">
        {view.badge && (
          <span className={`admin-badge ${view.isAdmin ? "is-you" : ""}`}>
            {view.isAdmin ? "★ " : ""}
            {view.badge}
          </span>
        )}
        {view.showToggle && (
          <label className="allow-all">
            <input
              type="checkbox"
              checked={view.allowAll}
              onChange={(e) => net.toggleAllowAll(roomId, e.target.checked)}
            />
            Allow all
          </label>
        )}
      </div>
      {view.atCapacity && view.allowAll && (
        <div className="room-admin-note">Room at max capacity — door closed until a slot frees.</div>
      )}
      {view.requests.length > 0 && (
        <div className="knock-requests">
          {view.requests.map((r) => (
            <div key={r.id} className="knock-request">
              <span className="knock-who">
                <strong>{r.name}</strong> wants to join
              </span>
              <div className="knock-request-actions">
                <button type="button" className="ghost" onClick={() => net.denyKnock(roomId, r.id)}>
                  Deny
                </button>
                <button type="button" onClick={() => net.approveKnock(roomId, r.id)}>
                  Approve
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
