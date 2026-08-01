/**
 * One player's seat: their mark, their name, and whether the match is waiting on
 * them. The active seat is called out with a lit chip AND a caret, never with
 * colour alone.
 */
import type { BoardGame } from "@metaverse/shared";
import BoardMark from "./BoardMark";

export interface SeatChipProps {
  game: BoardGame;
  seat: 0 | 1;
  name: string | null;
  /** The match is waiting on this seat's move. */
  active: boolean;
  /** This seat is the viewer. */
  isMe: boolean;
  /** Shown during an offer: this seat has accepted. */
  accepted: boolean;
  /** The match is in its offer phase, so acceptance state is meaningful. */
  offering: boolean;
}

export default function SeatChip({
  game,
  seat,
  name,
  active,
  isMe,
  accepted,
  offering,
}: SeatChipProps) {
  const classes = [
    "board-seat",
    `board-seat--p${seat + 1}`,
    active ? "is-active" : "",
    isMe ? "is-me" : "",
    name === null ? "is-empty" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <span className="board-seat__mark">
        <BoardMark game={game} seat={seat} />
      </span>
      <span className="board-seat__body">
        {/* A long display name still ellipsizes at the chip's width; the title
            keeps the whole thing reachable on hover. */}
        <span className="board-seat__name" title={name ?? undefined}>
          {name ?? "Open seat"}
        </span>
        {isMe && name !== null && <span className="board-seat__you">you</span>}
        {offering && name !== null && (
          <span className={`board-seat__ready${accepted ? " is-ready" : ""}`}>
            {accepted ? "ready" : "waiting"}
          </span>
        )}
      </span>
      {active && (
        <span className="board-seat__turn" aria-hidden="true">
          ▸
        </span>
      )}
    </div>
  );
}
