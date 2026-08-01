/**
 * The piece a player puts on the board. Tic-tac-toe gets real X and O glyphs —
 * the previous panel drew a filled dot for BOTH players and left colour as the
 * only difference, which is unreadable at a glance and unreadable full stop to
 * anyone who cannot separate the two hues. Connect 4 gets a disc, with the
 * second player's carrying an extra inner ring so the two are still telling
 * apart without colour.
 *
 * The strokes draw themselves in on mount. Because the caller keys the mark by
 * cell contents, React remounts it exactly when a piece is placed, so the
 * animation fires once per move with no animation state to track.
 */
import type { BoardGame } from "@metaverse/shared";

export interface BoardMarkProps {
  game: BoardGame;
  /** Which seat owns this piece. */
  seat: 0 | 1;
  /** Render as a translucent landing preview rather than a placed piece. */
  ghost?: boolean;
  /**
   * When true, play the place-in animation. Must be false for historical pieces
   * already on the board when the panel mounts (spectators must not redraw the
   * whole table).
   */
  animate?: boolean;
}

export default function BoardMark({ game, seat, ghost = false, animate = false }: BoardMarkProps) {
  const cls = `board-mark board-mark--p${seat + 1}${ghost ? " is-ghost" : ""}${animate ? " is-new" : ""}`;

  if (game === "connect4") {
    return (
      <span className={cls} aria-hidden="true">
        <span className="board-disc">{seat === 1 && <span className="board-disc__ring" />}</span>
      </span>
    );
  }

  // Tic-tac-toe: stroked SVG so the mark stays crisp at every cell size and can
  // draw itself in. viewBox is a 100-unit square inset by 22 units.
  return (
    <span className={cls} aria-hidden="true">
      <svg viewBox="0 0 100 100" className="board-glyph" focusable="false">
        {seat === 0 ? (
          <>
            <line x1="24" y1="24" x2="76" y2="76" className="board-glyph__stroke" />
            <line x1="76" y1="24" x2="24" y2="76" className="board-glyph__stroke board-glyph__stroke--b" />
          </>
        ) : (
          <circle cx="50" cy="50" r="27" className="board-glyph__stroke board-glyph__ring" />
        )}
      </svg>
    </span>
  );
}
