/**
 * End-of-match banner. Says the outcome from the viewer's own point of view —
 * a spectator is told who won, a player is told whether they did. Purely
 * presentational: the outcome itself is decided in `game/boardTable`.
 */
import type { BoardOutcome } from "../../game/boardTable";

export interface BoardResultProps {
  outcome: BoardOutcome;
  /** The viewer's seat, or null when spectating. */
  mySeat: 0 | 1 | null;
  seatNames: readonly [string | null, string | null];
}

export default function BoardResult({ outcome, mySeat, seatNames }: BoardResultProps) {
  const { tone, headline, detail } = describe(outcome, mySeat, seatNames);
  return (
    <div className={`board-result board-result--${tone}`} role="status">
      <span className="board-result__headline">{headline}</span>
      {detail !== null && <span className="board-result__detail">{detail}</span>}
    </div>
  );
}

function describe(
  outcome: BoardOutcome,
  mySeat: 0 | 1 | null,
  seatNames: readonly [string | null, string | null],
): { tone: "win" | "lose" | "draw"; headline: string; detail: string | null } {
  const nameOf = (seat: 0 | 1) => seatNames[seat] ?? `Player ${seat + 1}`;

  if (outcome.kind === "draw") {
    return { tone: "draw", headline: "Draw", detail: "Nobody takes this one" };
  }

  if (outcome.kind === "forfeit") {
    // The leaver's seat is emptied, so a viewer still holding one has won.
    if (mySeat !== null) return { tone: "win", headline: "You win", detail: "Opponent left" };
    if (outcome.winnerSeat === null) {
      return { tone: "draw", headline: "Match abandoned", detail: null };
    }
    return { tone: "win", headline: `${nameOf(outcome.winnerSeat)} wins`, detail: "by forfeit" };
  }

  if (mySeat === null) {
    return { tone: "win", headline: `${nameOf(outcome.winnerSeat)} wins`, detail: null };
  }
  return outcome.winnerSeat === mySeat
    ? { tone: "win", headline: "You win!", detail: null }
    : { tone: "lose", headline: "You lose", detail: `${nameOf(outcome.winnerSeat)} takes it` };
}
