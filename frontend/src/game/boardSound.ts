/**
 * Board-table sound decisions — pure: plain values in, plain values out; no
 * Phaser, net, DOM or audio imports. Given the previous and current
 * authoritative snapshots plus the viewer's id, it returns the domain events to
 * emit on the bus; the mixer's event→clip table (`media/soundMixer.ts`) decides
 * what they actually sound like. Game logic stays audio-agnostic.
 *
 * This exists because the cues are genuinely per-viewer decisions and they were
 * previously wrong in two ways, inline in `App.tsx`:
 *   • every move played one clip, so you could not tell your own move from your
 *     opponent's without watching the panel;
 *   • every ending played the arcade game-over descend — the SAME "you lost"
 *     motif whether you won, lost or drew.
 * Both are now derived here and covered by transition tests.
 */
import type { BoardUpdatePayload } from "@metaverse/shared";

/**
 * The domain events a snapshot transition can produce, in emit order.
 * `board-place` is the viewer's own move; `board-place-far` is anyone else's.
 */
export type BoardSoundEvent =
  | "board-offer"
  | "board-match-start"
  | "board-place"
  | "board-place-far"
  | "board-win"
  | "board-lose"
  | "board-draw";

/** Count of occupied cells in a snapshot's board (0 when there is no match). */
function filled(snap: BoardUpdatePayload | undefined): number {
  return snap?.state?.board.filter((c) => c !== 0).length ?? 0;
}

/** The viewer's seat index, or null when spectating. */
function seatOf(snap: BoardUpdatePayload, selfId: string): 0 | 1 | null {
  if (snap.seats[0]?.id === selfId) return 0;
  if (snap.seats[1]?.id === selfId) return 1;
  return null;
}

/**
 * The cues for one snapshot transition, in the order they should be emitted.
 *
 * A move is only recognised when the PREVIOUS snapshot already had a live game
 * state: that is the only snapshot that knows whose turn it was, and it also
 * stops the first snapshot of an already-running match (joined as a spectator
 * mid-game) from firing a burst of phantom placements. The mover is read from
 * `before.state.turn` rather than `after.state.turn` because a winning or
 * drawing move deliberately leaves `turn` on the mover instead of flipping it
 * (see `shared/src/games/ticTacToe.ts`), so the "after" value is ambiguous.
 *
 * A terminal move emits both its placement and the outcome — the piece lands,
 * then the result reads over its tail.
 */
export function boardSoundEvents(
  before: BoardUpdatePayload | undefined,
  after: BoardUpdatePayload,
  selfId: string,
): BoardSoundEvent[] {
  const events: BoardSoundEvent[] = [];
  const mySeat = seatOf(after, selfId);

  // A match offer that needs THIS viewer's acceptance — spectators get nothing,
  // and the rematch requester (already accepted) should not hear the ping.
  if (
    after.phase === "offer" &&
    before?.phase !== "offer" &&
    mySeat !== null &&
    after.seats[mySeat]?.accepted !== true
  ) {
    events.push("board-offer");
  }

  // The match went live. Requires an observed transition: without `before` this
  // is simply the first snapshot we have for the table — which is what arrives
  // when you walk up to a game that started minutes ago — and announcing that
  // as a fresh start is a lie. (The offer prompt above deliberately does NOT
  // take this guard: if the first snapshot you ever see is an offer waiting on
  // you, you still need telling.)
  if (before !== undefined && before.phase !== "active" && after.phase === "active") {
    events.push("board-match-start");
  }

  // A piece was placed. `before.state` is required — see the doc comment.
  if (before?.state && filled(after) > filled(before)) {
    const moverSeat = before.state.turn - 1;
    events.push(moverSeat === mySeat ? "board-place" : "board-place-far");
  }

  // The match ended. Outcome is per-viewer: the loser must not hear the winner's
  // flourish, and a spectator hears the neutral "a match concluded" reading.
  // Same observed-transition rule as the start cue: the first snapshot of an
  // already-finished table must not replay its result at a passer-by.
  if (before !== undefined && before.phase !== "over" && after.phase === "over") {
    events.push(outcomeEvent(before, after, selfId, mySeat));
  }

  return events;
}

function outcomeEvent(
  before: BoardUpdatePayload | undefined,
  after: BoardUpdatePayload,
  selfId: string,
  mySeat: 0 | 1 | null,
): BoardSoundEvent {
  if (after.reason === "forfeit") {
    // A forfeit empties the leaver's seat, so anyone STILL seated is the winner.
    // The viewer who held a seat in `before` but holds none now is the one who
    // conceded — they must not be handed a victory flourish for walking away.
    const wasSeated = before !== undefined && seatOf(before, selfId) !== null;
    if (mySeat === null && wasSeated) return "board-lose";
    return "board-win";
  }

  const result = after.state?.result;
  if (result?.status === "draw") return "board-draw";
  if (result?.status === "won") {
    if (mySeat === null) return "board-win"; // spectator: someone won
    return result.winner - 1 === mySeat ? "board-win" : "board-lose";
  }
  return "board-draw"; // no decisive result recorded — neutral, never a loss sting
}
