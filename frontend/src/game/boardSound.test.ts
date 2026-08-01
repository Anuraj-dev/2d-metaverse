import { describe, expect, it } from "vitest";
import type { BoardOccupant, BoardUpdatePayload, Cell } from "@metaverse/shared";
import { boardSoundEvents } from "./boardSound";

const alice: BoardOccupant = { id: "a", name: "Alice", accepted: false };
const bob: BoardOccupant = { id: "b", name: "Bob", accepted: false };

/** A 9-cell tic-tac-toe board with the given cells filled for the given player. */
function board(fills: Record<number, 1 | 2> = {}): Cell[] {
  const cells = Array<Cell>(9).fill(0);
  for (const [i, p] of Object.entries(fills)) cells[Number(i)] = p;
  return cells;
}

function snap(over: Partial<BoardUpdatePayload>): BoardUpdatePayload {
  return {
    tableId: "ttt-1",
    game: "tictactoe",
    phase: "waiting",
    seats: [null, null],
    state: null,
    reason: null,
    ...over,
  };
}

/** An active match with `turn` to move and the given board. */
function active(turn: 1 | 2, cells: Cell[]): BoardUpdatePayload {
  return snap({
    phase: "active",
    seats: [alice, bob],
    state: { board: cells, turn, result: { status: "in_progress" } },
  });
}

describe("boardSoundEvents — placement, near vs far", () => {
  it("plays the near cue for the viewer's OWN move", () => {
    // Alice (seat 0 = player 1) was to move; after her move it is Bob's turn.
    const before = active(1, board());
    const after = active(2, board({ 4: 1 }));
    expect(boardSoundEvents(before, after, "a")).toEqual(["board-place"]);
  });

  it("plays the far cue for the opponent's move", () => {
    const before = active(1, board());
    const after = active(2, board({ 4: 1 }));
    expect(boardSoundEvents(before, after, "b")).toEqual(["board-place-far"]);
  });

  it("plays the far cue for a spectator — no move is ever 'theirs'", () => {
    const before = active(1, board());
    const after = active(2, board({ 4: 1 }));
    expect(boardSoundEvents(before, after, "watcher")).toEqual(["board-place-far"]);
  });

  it("reads the mover from the PREVIOUS turn, since a winning move does not flip it", () => {
    // Alice completes the top row: the rules leave `turn` on the winner (1),
    // so deriving the mover from the AFTER snapshot would credit the wrong seat.
    const before = active(1, board({ 0: 1, 1: 1, 3: 2, 4: 2 }));
    const after = snap({
      phase: "over",
      seats: [alice, bob],
      state: {
        board: board({ 0: 1, 1: 1, 2: 1, 3: 2, 4: 2 }),
        turn: 1,
        result: { status: "won", winner: 1, line: [0, 1, 2] },
      },
    });
    expect(boardSoundEvents(before, after, "a")).toEqual(["board-place", "board-win"]);
    expect(boardSoundEvents(before, after, "b")).toEqual(["board-place-far", "board-lose"]);
  });

  it("emits nothing for a snapshot that adds no piece", () => {
    const same = active(1, board({ 4: 1 }));
    expect(boardSoundEvents(same, same, "a")).toEqual([]);
  });

  it("stays silent on the FIRST snapshot of a match already in progress", () => {
    // Walking up to a game that started minutes ago: there is no previous
    // snapshot, so nothing was just placed and nothing just started.
    const after = active(2, board({ 0: 1, 4: 2, 8: 1 }));
    expect(boardSoundEvents(undefined, after, "watcher")).toEqual([]);
  });

  it("stays silent on the first snapshot of an already-FINISHED match", () => {
    // A passer-by must not have someone else's result replayed at them.
    const over = snap({
      phase: "over",
      seats: [alice, bob],
      state: {
        board: board({ 0: 1, 1: 1, 2: 1 }),
        turn: 1,
        result: { status: "won", winner: 1, line: [0, 1, 2] },
      },
    });
    expect(boardSoundEvents(undefined, over, "watcher")).toEqual([]);
  });
});

describe("boardSoundEvents — outcomes are per viewer", () => {
  const finished = (winner: 1 | 2) =>
    snap({
      phase: "over",
      seats: [alice, bob],
      state: {
        board: board({ 0: winner, 1: winner, 2: winner }),
        turn: winner,
        result: { status: "won", winner, line: [0, 1, 2] },
      },
    });

  it("the winner hears the win cue and the loser hears the lose cue", () => {
    const before = snap({ phase: "active", seats: [alice, bob], state: null });
    expect(boardSoundEvents(before, finished(1), "a")).toEqual(["board-win"]);
    expect(boardSoundEvents(before, finished(1), "b")).toEqual(["board-lose"]);
    expect(boardSoundEvents(before, finished(2), "a")).toEqual(["board-lose"]);
    expect(boardSoundEvents(before, finished(2), "b")).toEqual(["board-win"]);
  });

  it("a draw is its own cue for everyone — never the loss sting", () => {
    const before = snap({ phase: "active", seats: [alice, bob], state: null });
    const drawn = snap({
      phase: "over",
      seats: [alice, bob],
      state: { board: board(), turn: 1, result: { status: "draw" } },
    });
    for (const viewer of ["a", "b", "watcher"]) {
      expect(boardSoundEvents(before, drawn, viewer)).toEqual(["board-draw"]);
    }
  });

  it("a spectator hears the win cue — someone won, nobody lost from their seat", () => {
    const before = snap({ phase: "active", seats: [alice, bob], state: null });
    expect(boardSoundEvents(before, finished(1), "watcher")).toEqual(["board-win"]);
  });

  it("fires the outcome once, not on every repeat of the over snapshot", () => {
    const over = finished(1);
    expect(boardSoundEvents(over, over, "a")).toEqual([]);
  });
});

describe("boardSoundEvents — forfeits", () => {
  const beforeForfeit = snap({ phase: "active", seats: [alice, bob], state: null });

  it("the player left sitting wins", () => {
    // Bob walked; his seat is emptied.
    const after = snap({ phase: "over", seats: [alice, null], reason: "forfeit" });
    expect(boardSoundEvents(beforeForfeit, after, "a")).toEqual(["board-win"]);
  });

  it("the player who WALKED does not get handed a victory flourish", () => {
    const after = snap({ phase: "over", seats: [alice, null], reason: "forfeit" });
    expect(boardSoundEvents(beforeForfeit, after, "b")).toEqual(["board-lose"]);
  });

  it("a spectator hears the win cue for a forfeit", () => {
    const after = snap({ phase: "over", seats: [alice, null], reason: "forfeit" });
    expect(boardSoundEvents(beforeForfeit, after, "watcher")).toEqual(["board-win"]);
  });
});

describe("boardSoundEvents — match lifecycle", () => {
  it("prompts the seated players when an offer opens, and nobody else", () => {
    const before = snap({ phase: "waiting", seats: [alice, null] });
    const after = snap({ phase: "offer", seats: [alice, bob] });
    expect(boardSoundEvents(before, after, "a")).toEqual(["board-offer"]);
    expect(boardSoundEvents(before, after, "b")).toEqual(["board-offer"]);
    expect(boardSoundEvents(before, after, "watcher")).toEqual([]);
  });

  it("does not re-prompt while the offer stands", () => {
    const offer = snap({ phase: "offer", seats: [alice, bob] });
    expect(boardSoundEvents(offer, offer, "a")).toEqual([]);
  });

  it("announces the match going live, to players and spectators alike", () => {
    const before = snap({ phase: "offer", seats: [alice, bob] });
    const after = active(1, board());
    expect(boardSoundEvents(before, after, "a")).toEqual(["board-match-start"]);
    expect(boardSoundEvents(before, after, "watcher")).toEqual(["board-match-start"]);
  });

  it("does not announce the start again on every later active snapshot", () => {
    const before = active(1, board());
    const after = active(2, board({ 0: 1 }));
    expect(boardSoundEvents(before, after, "a")).toEqual(["board-place"]);
  });
});
