import { useEffect, useState } from "react";
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

  const ordered = [...players].sort((a, b) =>
    a.id === selfId ? -1 : b.id === selfId ? 1 : a.name.localeCompare(b.name)
  );

  return (
    <div className={`roster ${open ? "open" : ""}`}>
      <button className="roster-head" onClick={() => setOpen((o) => !o)}>
        👥 {players.length}
      </button>
      {open && (
        <div className="roster-list">
          {ordered.map((e) => (
            <button
              key={e.id}
              className="roster-row"
              onClick={() => bus.emit("locate", { id: e.id })}
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
