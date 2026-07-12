import { useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { roomDisplayName, type PlayerState } from "@metaverse/shared";
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
  const [selfId, setSelfId] = useState<string | null>(() => sharedNet().selfId || null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [admin, setAdmin] = useState<AdminRef | null>(null);
  const [open, setOpen] = useState<RoomOpenState | undefined>(undefined);
  const [pending, setPending] = useState<Requester[]>([]);
  // The panel is bound to exactly one room; `room-open-state` is a SPACE-WIDE
  // broadcast (door visuals for every client), so events for other rooms must
  // be ignored or a neighbouring room's toggle would corrupt this admin's
  // controls. A ref (not the `roomId` state) is read inside the mount-once
  // effect's handlers, which would otherwise close over a stale `null`.
  const roomIdRef = useRef<string | null>(null);

  useEffect(() => {
    const net = sharedNet();
    const offInit = net.on("init", (p: { selfId: string; players: PlayerState[] }) => setSelfId(p.selfId));

    // Entering / leaving a room scopes the panel and clears stale state.
    const offEntered = bus.on("room-entered", (p: { roomId: string }) => {
      roomIdRef.current = p.roomId;
      setRoomId(p.roomId);
    });
    const offLeft = bus.on("room-left", () => {
      roomIdRef.current = null;
      setRoomId(null);
      setAdmin(null);
      setOpen(undefined);
      setPending([]);
    });

    const offAdmin = net.on(
      "admin-changed",
      (p: { roomId: string; admin: AdminRef | null; reason: "initial" | "succession" }) => {
        if (p.roomId !== roomIdRef.current) return;
        setAdmin(p.admin);
        // "You are now the admin" cue on a hand-off (not the initial self-grant).
        if (p.reason === "succession" && p.admin && p.admin.id === net.selfId) bus.emit("admin-promoted");
      },
    );
    const offOpen = net.on(
      "room-open-state",
      (p: { roomId: string; allowAll: boolean; atCapacity: boolean }) => {
        if (p.roomId !== roomIdRef.current) return;
        setOpen({ allowAll: p.allowAll, atCapacity: p.atCapacity });
      },
    );
    const offPending = net.on(
      "knock-pending",
      (p: { roomId: string; knocks: Requester[] }) => {
        if (p.roomId !== roomIdRef.current) return;
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
    <div className="room-admin" data-dialog-keep-live>
      <div className="room-admin-name">{roomDisplayName(roomId)}</div>
      <div className="room-admin-bar">
        {view.badge && (
          <span className={`admin-badge ${view.isAdmin ? "is-you" : ""}`}>
            {view.isAdmin && (
              <Star className="admin-badge-star" size={13} fill="currentColor" aria-hidden="true" />
            )}
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
