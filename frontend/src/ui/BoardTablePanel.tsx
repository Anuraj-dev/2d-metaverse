/**
 * Board-table HUD panel (PRD 11 phase 2). A thin renderer: it turns an
 * authoritative snapshot into a view via the pure `boardTableView` module and
 * reports clicks/accept/leave upward. It does NOT sleep the world — players stay
 * seated in-world while it floats over the HUD. Lazy-loaded so the board code
 * stays out of the entry chunk.
 *
 * Composed from small pieces in `ui/board/` (seat chip, grid, mark, result
 * banner) so no one file owns the whole surface.
 */
import { useState } from "react";
import type { BoardUpdatePayload } from "@metaverse/shared";
import { boardTableView } from "../game/boardTable";
import BoardGrid from "./board/BoardGrid";
import BoardResult from "./board/BoardResult";
import SeatChip from "./board/SeatChip";
import "./board/board.css";

export interface BoardTablePanelProps {
  snapshot: BoardUpdatePayload;
  selfId: string;
  /** Message for the last rejected action, or null. */
  error: string | null;
  onMove: (index: number) => void;
  onAccept: () => void;
  onLeave: () => void;
}

const TABLE_TITLES: Record<string, string> = { tictactoe: "Tic-Tac-Toe", connect4: "Connect 4" };

export default function BoardTablePanel({
  snapshot,
  selfId,
  error,
  onMove,
  onAccept,
  onLeave,
}: BoardTablePanelProps) {
  const view = boardTableView(snapshot, selfId);
  const title = TABLE_TITLES[view.game] ?? "Board game";

  // Animate only 0→filled transitions observed while this panel is open so a
  // spectator mounting mid-match does not redraw the whole historical board.
  const [memory, setMemory] = useState(() => ({
    tableId: snapshot.tableId,
    cells: view.cells,
    fresh: new Set<number>(),
  }));
  let current = memory;
  if (memory.tableId !== snapshot.tableId) {
    current = { tableId: snapshot.tableId, cells: view.cells, fresh: new Set<number>() };
    setMemory(current);
  } else if (
    memory.cells.length !== view.cells.length ||
    memory.cells.some((v, i) => v !== view.cells[i])
  ) {
    const fresh = new Set(memory.fresh);
    for (let i = 0; i < view.cells.length; i++) {
      if (view.cells[i] === 0) fresh.delete(i);
      else if (memory.cells[i] === 0) fresh.add(i);
    }
    current = { tableId: snapshot.tableId, cells: view.cells, fresh };
    setMemory(current);
  }

  const classes = [
    "board-panel",
    `board-panel--${view.game}`,
    view.interactive ? "is-my-turn" : "",
    view.outcome !== null ? "is-over" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes} aria-label={`${title} table`}>
      <header className="board-panel__head">
        <h2 className="board-panel__title">{title}</h2>
        {view.spectating && <span className="board-panel__badge">Watching</span>}
      </header>

      <div className="board-panel__seats">
        <SeatChip
          game={view.game}
          seat={0}
          name={view.seatNames[0]}
          active={view.activeSeat === 0}
          isMe={view.mySeat === 0}
          accepted={view.seatAccepted[0]}
          offering={view.phase === "offer"}
        />
        <span className="board-panel__vs" aria-hidden="true">
          vs
        </span>
        <SeatChip
          game={view.game}
          seat={1}
          name={view.seatNames[1]}
          active={view.activeSeat === 1}
          isMe={view.mySeat === 1}
          accepted={view.seatAccepted[1]}
          offering={view.phase === "offer"}
        />
      </div>

      <BoardGrid view={view} onMove={onMove} fresh={current.fresh} />

      {view.outcome !== null && (
        <BoardResult outcome={view.outcome} mySeat={view.mySeat} seatNames={view.seatNames} />
      )}
      {(error !== null || view.outcome === null) && (
        <p className={`board-panel__status${error !== null ? " is-error" : ""}`} role="status">
          {error ?? view.status}
        </p>
      )}

      <div className="board-panel__actions">
        {view.canAccept && (
          <button type="button" className="board-btn board-btn--accept" onClick={onAccept}>
            Accept match
          </button>
        )}
        {/* A rematch IS an acceptance — the server re-opens the offer from a
            finished match, so this rides the same event as the accept above. */}
        {view.canReplay && (
          <button type="button" className="board-btn board-btn--accept" onClick={onAccept}>
            Play again
          </button>
        )}
        {!view.spectating && (
          <button type="button" className="board-btn" onClick={onLeave}>
            Leave table
          </button>
        )}
      </div>
    </section>
  );
}
