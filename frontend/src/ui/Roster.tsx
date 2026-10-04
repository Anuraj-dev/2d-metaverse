import { useEffect, useId, useRef, useState } from "react";
import { Users } from "lucide-react";
import type { PlayerState } from "@metaverse/shared";
import { sharedNet } from "../net/shared";
import { bus } from "../game/eventBus";

interface Entry {
  id: string;
  name: string;
}

/** "Who's here" roster, built entirely from net presence events. Click a name to
 *  pan the camera to that player. */
export default function Roster() {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const [players, setPlayers] = useState<Entry[]>([]);
  const [selfId, setSelfId] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const net = sharedNet();
    const offInit = net.on(
      "init",
      (p: { selfId: string; players: PlayerState[] }) => {
        setSelfId(p.selfId);
        setPlayers(p.players.map((x) => ({ id: x.id, name: x.name })));
      }
    );
    const offJoin = net.on("player-joined", (p: PlayerState) =>
      setPlayers((prev) =>
        prev.some((e) => e.id === p.id) ? prev : [...prev, { id: p.id, name: p.name }]
      )
    );
    const offLeft = net.on("player-left", (p: { id: string }) =>
      setPlayers((prev) => prev.filter((e) => e.id !== p.id))
    );
    return () => {
      offInit();
      offJoin();
      offLeft();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [open]);

  const ordered = [...players].sort((a, b) =>
    a.id === selfId ? -1 : b.id === selfId ? 1 : a.name.localeCompare(b.name)
  );

  return (
    <div ref={rootRef} className={`roster ${open ? "open" : ""}`} onKeyDown={(event) => {
      if (!open || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }} onBlur={(event) => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button
        ref={triggerRef}
        type="button"
        className="roster-head"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Roster: ${players.length} online`}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
      >
        <Users size={14} aria-hidden="true" /> {players.length}
      </button>
      {open && (
        <div id={listId} className="roster-list" role="group" aria-label="People online">
          {ordered.map((e) => (
            <button
              key={e.id}
              type="button"
              className="roster-row"
              onClick={() => {
                bus.emit("locate", { id: e.id });
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <span className="roster-dot" />
              {e.name}
              {e.id === selfId && <span className="roster-you">you</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
