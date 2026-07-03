/**
 * Board-table HUD panel (PRD 11 phase 2). A thin renderer: it turns an
 * authoritative snapshot into a grid via the pure `boardTableView` module and
 * reports clicks/accept/leave upward. It does NOT sleep the world — players stay
 * seated in-world while it floats over the HUD. Lazy-loaded so the board code
 * stays out of the entry chunk.
 */
import type { BoardUpdatePayload } from "@metaverse/shared";
import { boardTableView, clickToMove } from "../game/boardTable";
import "./BoardTablePanel.css";

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

export default function BoardTablePanel({ snapshot, selfId, error, onMove, onAccept, onLeave }: BoardTablePanelProps) {
  const view = boardTableView(snapshot, selfId);
  const winning = new Set(view.winningLine);

  return (
    <div className="board-panel" role="dialog" aria-label={`${TABLE_TITLES[view.game] ?? "Board game"} table`}>
      <div className="board-panel__head">
        <span className="board-panel__title">{TABLE_TITLES[view.game] ?? "Board game"}</span>
        {view.spectating && <span className="board-panel__badge">Spectating</span>}
      </div>

      <div className="board-panel__seats">
        <span className={`board-panel__seat board-panel__seat--p1${view.mySeat === 0 ? " is-me" : ""}`}>
          {view.seatNames[0] ?? "Empty"}
        </span>
        <span className="board-panel__vs">vs</span>
        <span className={`board-panel__seat board-panel__seat--p2${view.mySeat === 1 ? " is-me" : ""}`}>
          {view.seatNames[1] ?? "Empty"}
        </span>
      </div>

      <div
        className={`board-panel__grid board-panel__grid--${view.game}`}
        style={{ gridTemplateColumns: `repeat(${view.columns}, 1fr)` }}
      >
        {view.cells.map((cell, i) => (
          <button
            key={i}
            type="button"
            className={`board-cell${cell === 1 ? " p1" : cell === 2 ? " p2" : ""}${winning.has(i) ? " win" : ""}`}
            disabled={!view.interactive}
            aria-label={`cell ${i}${cell === 0 ? " empty" : cell === 1 ? " player one" : " player two"}`}
            onClick={() => view.interactive && onMove(clickToMove(view.game, i))}
          >
            {cell === 1 ? "●" : cell === 2 ? "●" : ""}
          </button>
        ))}
      </div>

      <div className="board-panel__status" role="status">
        {error ?? view.status}
      </div>

      <div className="board-panel__actions">
        {view.canAccept && (
          <button type="button" className="board-panel__btn board-panel__btn--accept" onClick={onAccept}>
            Accept match
          </button>
        )}
        {!view.spectating && (
          <button type="button" className="board-panel__btn" onClick={onLeave}>
            Leave table
          </button>
        )}
      </div>
    </div>
  );
}
