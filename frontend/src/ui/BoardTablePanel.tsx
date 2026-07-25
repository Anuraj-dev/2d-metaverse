/**
 * Board-table HUD panel (PRD 11 phase 2). A thin renderer: it turns an
 * authoritative snapshot into a grid via the pure `boardTableView` module and
 * reports clicks/accept/leave upward. It does NOT sleep the world — players stay
 * seated in-world while it floats over the HUD. Lazy-loaded so the board code
 * stays out of the entry chunk.
 *
 * Issue #163 adds the motion: Connect-4 discs fall into place, tic-tac-toe marks
 * draw themselves in, and the winning line lights up along its length. A mark
 * animates only on a 0→filled TRANSITION between snapshots — never on initial
 * population — so a spectator joining an active table sees the historical
 * pieces already settled instead of all falling at once. The previous cells are
 * remembered with React's previous-render state pattern, and once a cell is
 * flagged as new it stays flagged for the rest of the match, so a re-render
 * landing mid-animation never strips the class and cuts the motion short. The
 * only decisions — how
 * far a disc falls, and a cell's position in the win line — come from the pure
 * module. Sounds stay out of here: App.tsx emits `board-move` / `board-win` on
 * the bus and the sound mixer picks the clip.
 */
import { useState, type CSSProperties } from "react";
import type { BoardGame, BoardUpdatePayload } from "@metaverse/shared";
import { boardTableView, cellRow, clickToMove, winLineStep } from "../game/boardTable";
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

/**
 * CSS custom properties are not part of React's CSSProperties type; this is the
 * standard, contained cast for passing them through `style`.
 */
function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

/**
 * The piece drawn in a filled cell. Connect-4 gets a disc that drops from above
 * its landing row; tic-tac-toe gets a stroke-drawn X or O. `pathLength="1"`
 * normalises each stroke so one dash-offset keyframe animates any shape.
 */
function Mark({
  game,
  player,
  row,
  animate,
}: {
  game: BoardGame;
  player: 1 | 2;
  row: number;
  /** True only for a mark that appeared via a 0→filled transition this match. */
  animate: boolean;
}) {
  const anim = animate ? " is-new" : "";
  if (game === "connect4") {
    return (
      <span
        className={`board-disc board-disc--p${player}${anim}`}
        style={cssVars({ "--drop-rows": row })}
        aria-hidden="true"
      />
    );
  }
  if (player === 1) {
    return (
      <svg className={`board-mark board-mark--x${anim}`} viewBox="0 0 32 32" aria-hidden="true">
        <line x1="8" y1="8" x2="24" y2="24" pathLength="1" />
        <line x1="24" y1="8" x2="8" y2="24" pathLength="1" />
      </svg>
    );
  }
  return (
    <svg className={`board-mark board-mark--o${anim}`} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="9" pathLength="1" />
    </svg>
  );
}

/** Value-equality for two flat cell arrays (boardCells builds a new array per render). */
function sameCells(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** What the panel remembers between snapshots to gate the mark animations. */
interface MarkMemory {
  tableId: string;
  cells: readonly number[];
  /** Cells that filled while the panel was watching — the only ones to animate. */
  fresh: ReadonlySet<number>;
}

export default function BoardTablePanel({ snapshot, selfId, error, onMove, onAccept, onLeave }: BoardTablePanelProps) {
  const view = boardTableView(snapshot, selfId);

  // Which cells filled since the previous rendered snapshot of THIS table,
  // via React's documented "storing information from previous renders"
  // pattern (state adjusted during render behind a value comparison). Seeded
  // with the mount snapshot as the baseline, so initial population never
  // animates; a cell emptying (a new match on the same table) drops back out
  // of the set, while a filled cell STAYS in it for the rest of the match so
  // a re-render can never strip the class mid-animation.
  const [memory, setMemory] = useState<MarkMemory>(() => ({
    tableId: snapshot.tableId,
    cells: view.cells,
    fresh: new Set<number>(),
  }));
  let current = memory;
  if (memory.tableId !== snapshot.tableId) {
    current = { tableId: snapshot.tableId, cells: view.cells, fresh: new Set<number>() };
    setMemory(current);
  } else if (!sameCells(memory.cells, view.cells)) {
    const fresh = new Set(memory.fresh);
    for (let i = 0; i < view.cells.length; i++) {
      if (view.cells[i] === 0) fresh.delete(i);
      else if (memory.cells[i] === 0) fresh.add(i);
    }
    current = { tableId: snapshot.tableId, cells: view.cells, fresh };
    setMemory(current);
  }
  const fresh = current.fresh;

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
        {view.cells.map((cell, i) => {
          const player: 1 | 2 | null = cell === 1 ? 1 : cell === 2 ? 2 : null;
          const step = winLineStep(view.winningLine, i);
          return (
            <button
              key={i}
              type="button"
              className={`board-cell${player === 1 ? " p1" : player === 2 ? " p2" : ""}${step !== null ? " win" : ""}`}
              style={cssVars(step !== null ? { "--win-step": step } : {})}
              disabled={!view.interactive}
              aria-label={`cell ${i}${player === null ? " empty" : player === 1 ? " player one" : " player two"}`}
              onClick={() => view.interactive && onMove(clickToMove(view.game, i))}
            >
              {player !== null && (
                <Mark
                  game={view.game}
                  player={player}
                  row={cellRow(i, view.columns)}
                  animate={fresh.has(i)}
                />
              )}
            </button>
          );
        })}
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
