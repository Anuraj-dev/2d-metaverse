/**
 * The playfield. A thin renderer over {@link BoardTableView}: every decision it
 * draws from (whose piece is where, whether a move is legal, where a Connect-4
 * disc would land, which cells won) comes from the pure `game/boardTable`
 * module — this file only turns those values into DOM.
 *
 * Two things it adds over a bare grid of buttons, both of which the previous
 * panel lacked:
 *   • a landing preview — hovering or focusing any cell of a Connect-4 column
 *     shows a ghost piece in the cell the disc would actually rest in;
 *   • usable keyboard access — Connect 4 exposes one tab stop per column (the
 *     landing cell) rather than 42, and every cell is labelled by its real
 *     row/column and occupant instead of a flat index.
 */
import { useState } from "react";
import { cellPosition, clickToMove, dropTarget, type BoardTableView } from "../../game/boardTable";
import BoardMark from "./BoardMark";

export interface BoardGridProps {
  view: BoardTableView;
  onMove: (index: number) => void;
}

export default function BoardGrid({ view, onMove }: BoardGridProps) {
  // The cell a piece would land in for the currently hovered/focused cell.
  const [preview, setPreview] = useState<number | null>(null);
  const winning = new Set(view.winningLine);
  const isConnect4 = view.game === "connect4";

  return (
    <div
      className={`board-grid board-grid--${view.game}${view.interactive ? " is-live" : ""}`}
      style={{ gridTemplateColumns: `repeat(${view.columns}, var(--board-cell))` }}
      role="group"
      aria-label={isConnect4 ? "Connect 4 board" : "Tic-tac-toe board"}
      onMouseLeave={() => setPreview(null)}
    >
      {view.cells.map((cell, i) => {
        const { row, column } = cellPosition(i, view.columns);
        const owner = cell === 0 ? null : cell === 1 ? 0 : 1;
        const landing = view.interactive
          ? dropTarget(view.game, view.cells, i, view.columns, view.rows)
          : null;
        // Connect 4: any cell plays its column, so the whole column stays
        // clickable while it has room. Tic-tac-toe: only the empty cell itself.
        const playable = landing !== null;
        const isLanding = landing === i;
        const showGhost = playable && preview === landing && isLanding && view.mySeat !== null;

        const classes = [
          "board-cell",
          owner !== null ? `is-p${owner + 1}` : "is-empty",
          winning.has(i) ? "is-win" : "",
          isLanding && view.interactive ? "is-landing" : "",
          view.outcome !== null && owner !== null && !winning.has(i) ? "is-faded" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <button
            key={i}
            type="button"
            className={classes}
            disabled={!playable}
            // Connect 4 would otherwise put 42 stops in the tab order; only the
            // cell a disc would actually land in is worth stopping on.
            tabIndex={isConnect4 && !isLanding ? -1 : undefined}
            aria-label={cellLabel(view, row, column, owner, isLanding)}
            onMouseEnter={() => setPreview(landing)}
            onFocus={() => setPreview(landing)}
            onBlur={() => setPreview(null)}
            onClick={() => playable && onMove(clickToMove(view.game, i))}
          >
            {owner !== null && <BoardMark key={`${i}-${cell}`} game={view.game} seat={owner} />}
            {showGhost && view.mySeat !== null && (
              <BoardMark game={view.game} seat={view.mySeat} ghost />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A spoken label naming the real square and who holds it. */
function cellLabel(
  view: BoardTableView,
  row: number,
  column: number,
  owner: 0 | 1 | null,
  isLanding: boolean,
): string {
  const where = `row ${row + 1}, column ${column + 1}`;
  if (owner !== null) return `${where}, ${view.seatNames[owner] ?? `player ${owner + 1}`}`;
  if (view.game === "connect4" && view.interactive && isLanding) {
    return `${where}, empty, drop here in column ${column + 1}`;
  }
  return `${where}, empty`;
}
