import { describe, expect, it } from "vitest";
import type { BoardOccupant, BoardUpdatePayload } from "@metaverse/shared";
import {
  boardSeatHolder,
  boardSeatOccupants,
  boardTableView,
  canTakeBoardSeat,
  cellPosition,
  clickToMove,
  dropTarget,
} from "./boardTable";

const board9 = (fill: 0 | 1 | 2 = 0): (0 | 1 | 2)[] => Array<0 | 1 | 2>(9).fill(fill);

const alice: BoardOccupant = { id: "a", name: "Alice", accepted: false };
const bob: BoardOccupant = { id: "b", name: "Bob", accepted: false };

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

describe("clickToMove", () => {
  it("maps a tic-tac-toe cell to itself", () => {
    expect(clickToMove("tictactoe", 5)).toBe(5);
  });
  it("maps a Connect-4 cell to its column", () => {
    expect(clickToMove("connect4", 0)).toBe(0);
    expect(clickToMove("connect4", 9)).toBe(2); // row 1, col 2 → column 2
    expect(clickToMove("connect4", 41)).toBe(6);
  });
});

describe("cellPosition", () => {
  it("maps a flat row-major index onto its row and column", () => {
    expect(cellPosition(0, 3)).toEqual({ row: 0, column: 0 });
    expect(cellPosition(4, 3)).toEqual({ row: 1, column: 1 });
    expect(cellPosition(8, 3)).toEqual({ row: 2, column: 2 });
    expect(cellPosition(9, 7)).toEqual({ row: 1, column: 2 });
    expect(cellPosition(41, 7)).toEqual({ row: 5, column: 6 });
  });
});

describe("dropTarget — where a piece actually lands", () => {
  /** A 42-cell Connect-4 board with the listed indices occupied. */
  const c4 = (...filled: number[]): (0 | 1 | 2)[] => {
    const cells = Array<0 | 1 | 2>(42).fill(0);
    for (const i of filled) cells[i] = 1;
    return cells;
  };

  it("tic-tac-toe has no gravity: an empty cell is its own target", () => {
    expect(dropTarget("tictactoe", board9(), 4, 3, 3)).toBe(4);
  });

  it("tic-tac-toe rejects an occupied cell", () => {
    const cells = board9();
    cells[4] = 1;
    expect(dropTarget("tictactoe", cells, 4, 3, 3)).toBeNull();
  });

  it("Connect 4 drops to the bottom row of an empty column", () => {
    // Column 0's bottom cell is index 35 on a 7-wide, 6-tall board.
    expect(dropTarget("connect4", c4(), 0, 7, 6)).toBe(35);
    expect(dropTarget("connect4", c4(), 35, 7, 6)).toBe(35);
  });

  it("Connect 4 stacks on top of the pieces already in the column", () => {
    expect(dropTarget("connect4", c4(35), 0, 7, 6)).toBe(28);
    expect(dropTarget("connect4", c4(35, 28), 0, 7, 6)).toBe(21);
  });

  it("any cell in a column resolves to the SAME landing cell", () => {
    const cells = c4(35);
    // Every cell of column 0: 0, 7, 14, 21, 28, 35.
    for (const cell of [0, 7, 14, 21, 28, 35]) {
      expect(dropTarget("connect4", cells, cell, 7, 6)).toBe(28);
    }
  });

  it("a full Connect-4 column has no landing cell", () => {
    expect(dropTarget("connect4", c4(0, 7, 14, 21, 28, 35), 0, 7, 6)).toBeNull();
  });

  it("rejects out-of-range indices for both games", () => {
    expect(dropTarget("tictactoe", board9(), -1, 3, 3)).toBeNull();
    expect(dropTarget("tictactoe", board9(), 9, 3, 3)).toBeNull();
    expect(dropTarget("connect4", c4(), 42, 7, 6)).toBeNull();
  });
});

describe("board-seat occupancy (client-side seat-taken prevention)", () => {
  it("reads occupant ids per seat, null when empty", () => {
    expect(boardSeatOccupants(snap({ seats: [alice, null] }))).toEqual(["a", null]);
    expect(boardSeatOccupants(snap({ seats: [alice, bob] }))).toEqual(["a", "b"]);
    expect(boardSeatOccupants(snap({ seats: [null, null] }))).toEqual([null, null]);
  });

  it("boardSeatHolder returns the seat's id (null for empty or out-of-range)", () => {
    expect(boardSeatHolder(["a", "b"], 0)).toBe("a");
    expect(boardSeatHolder(["a", "b"], 1)).toBe("b");
    expect(boardSeatHolder(["a", null], 1)).toBeNull();
    expect(boardSeatHolder(["a", "b"], 2)).toBeNull();
  });

  it("an empty seat is takeable by anyone", () => {
    expect(canTakeBoardSeat([null, null], 0, "a")).toBe(true);
    expect(canTakeBoardSeat(["a", null], 1, "b")).toBe(true);
  });

  it("a seat held by another player is NOT takeable (would double-seat)", () => {
    expect(canTakeBoardSeat(["a", null], 0, "b")).toBe(false);
    expect(canTakeBoardSeat(["a", "b"], 1, "a")).toBe(false);
  });

  it("re-taking your own seat is allowed (no-op re-sit)", () => {
    expect(canTakeBoardSeat(["a", null], 0, "a")).toBe(true);
    expect(canTakeBoardSeat(["a", "b"], 1, "b")).toBe(true);
  });

  it("an out-of-range seat index is treated as empty/takeable", () => {
    expect(canTakeBoardSeat(["a", "b"], 2, "c")).toBe(true);
  });
});

describe("boardTableView — seat + phase", () => {
  it("waiting with one seat asks for a second player", () => {
    const view = boardTableView(snap({ phase: "waiting", seats: [alice, null] }), "a");
    expect(view.mySeat).toBe(0);
    expect(view.spectating).toBe(false);
    expect(view.status).toBe("Waiting for a second player");
    expect(view.cells).toHaveLength(9);
    expect(view.cells.every((c) => c === 0)).toBe(true);
  });

  it("offer prompts the un-accepted seated viewer to accept", () => {
    const view = boardTableView(snap({ phase: "offer", seats: [alice, bob] }), "a");
    expect(view.canAccept).toBe(true);
    expect(view.status).toBe("Accept to start the match");
  });

  it("offer after the viewer accepted waits on the opponent", () => {
    const view = boardTableView(
      snap({ phase: "offer", seats: [{ ...alice, accepted: true }, bob] }),
      "a",
    );
    expect(view.canAccept).toBe(false);
    expect(view.status).toBe("Waiting for your opponent to accept");
  });
});

describe("boardTableView — active turns", () => {
  const active = (turn: 1 | 2): BoardUpdatePayload =>
    snap({
      phase: "active",
      seats: [{ ...alice, accepted: true }, { ...bob, accepted: true }],
      state: { board: board9(), turn, result: { status: "in_progress" } },
    });

  it("marks the seated player's own turn interactive", () => {
    const mine = boardTableView(active(1), "a");
    expect(mine.interactive).toBe(true);
    expect(mine.status).toBe("Your turn");

    const theirs = boardTableView(active(2), "a");
    expect(theirs.interactive).toBe(false);
    expect(theirs.status).toBe("Waiting for Bob");
  });

  it("never lets a spectator interact", () => {
    const view = boardTableView(active(1), "zzz");
    expect(view.spectating).toBe(true);
    expect(view.interactive).toBe(false);
    expect(view.status).toBe("Alice to move");
  });

  it("names the seat the match is waiting on — the same for every viewer", () => {
    // `activeSeat` drives the turn indicator, so it must be about the BOARD,
    // not about who is looking at it (unlike `interactive`).
    expect(boardTableView(active(1), "a").activeSeat).toBe(0);
    expect(boardTableView(active(1), "b").activeSeat).toBe(0);
    expect(boardTableView(active(1), "zzz").activeSeat).toBe(0);
    expect(boardTableView(active(2), "a").activeSeat).toBe(1);
  });

  it("has no active seat while no move is pending", () => {
    expect(boardTableView(snap({ phase: "waiting", seats: [alice, null] }), "a").activeSeat).toBeNull();
    expect(boardTableView(snap({ phase: "offer", seats: [alice, bob] }), "a").activeSeat).toBeNull();
  });

  it("reports per-seat acceptance during an offer", () => {
    const view = boardTableView(
      snap({ phase: "offer", seats: [{ ...alice, accepted: true }, bob] }),
      "a",
    );
    expect(view.seatAccepted).toEqual([true, false]);
  });
});

describe("boardTableView — endings", () => {
  it("reports a win/loss from each viewpoint and highlights the line", () => {
    const won = snap({
      phase: "over",
      reason: "win",
      seats: [{ ...alice, accepted: true }, { ...bob, accepted: true }],
      state: {
        board: [1, 1, 1, 0, 0, 0, 0, 0, 0],
        turn: 1,
        result: { status: "won", winner: 1, line: [0, 1, 2] },
      },
    });
    expect(boardTableView(won, "a").status).toBe("You win!");
    expect(boardTableView(won, "b").status).toBe("You lose");
    expect(boardTableView(won, "spectator").status).toBe("Alice wins");
    expect(boardTableView(won, "a").winningLine).toEqual([0, 1, 2]);
  });

  it("reports a draw", () => {
    const draw = snap({
      phase: "over",
      reason: "draw",
      seats: [{ ...alice, accepted: true }, { ...bob, accepted: true }],
      state: { board: board9(1), turn: 1, result: { status: "draw" } },
    });
    expect(boardTableView(draw, "a").status).toBe("Draw");
  });

  it("reports a forfeit: the emptied seat lost, the remaining seat won", () => {
    const forfeit = snap({
      phase: "over",
      reason: "forfeit",
      seats: [null, { ...bob, accepted: true }],
      state: { board: board9(), turn: 1, result: { status: "in_progress" } },
    });
    expect(boardTableView(forfeit, "b").status).toBe("Opponent left — you win!");
    // The forfeiter's seat is emptied, so they (and any spectator) see the same.
    expect(boardTableView(forfeit, "a").status).toBe("Bob wins by forfeit");
    expect(boardTableView(forfeit, "spectator").status).toBe("Bob wins by forfeit");
  });
});

describe("boardTableView — outcome (seat-indexed, for the result banner)", () => {
  const seated: [BoardOccupant, BoardOccupant] = [
    { ...alice, accepted: true },
    { ...bob, accepted: true },
  ];

  it("is null while the match is unfinished", () => {
    expect(boardTableView(snap({ phase: "waiting", seats: [alice, null] }), "a").outcome).toBeNull();
    expect(boardTableView(snap({ phase: "offer", seats: seated }), "a").outcome).toBeNull();
    expect(
      boardTableView(
        snap({
          phase: "active",
          seats: seated,
          state: { board: board9(), turn: 1, result: { status: "in_progress" } },
        }),
        "a",
      ).outcome,
    ).toBeNull();
  });

  it("translates the winning BoardPlayer into a seat index", () => {
    const won = (winner: 1 | 2) =>
      snap({
        phase: "over",
        reason: "win",
        seats: seated,
        state: {
          board: [winner, winner, winner, 0, 0, 0, 0, 0, 0],
          turn: winner,
          result: { status: "won", winner, line: [0, 1, 2] },
        },
      });
    expect(boardTableView(won(1), "a").outcome).toEqual({ kind: "won", winnerSeat: 0 });
    expect(boardTableView(won(2), "a").outcome).toEqual({ kind: "won", winnerSeat: 1 });
  });

  it("reports a draw", () => {
    const draw = snap({
      phase: "over",
      reason: "draw",
      seats: seated,
      state: { board: board9(1), turn: 1, result: { status: "draw" } },
    });
    expect(boardTableView(draw, "a").outcome).toEqual({ kind: "draw" });
  });

  it("credits a forfeit to whichever seat is still occupied", () => {
    const forfeit = snap({ phase: "over", reason: "forfeit", seats: [null, seated[1]] });
    expect(boardTableView(forfeit, "b").outcome).toEqual({ kind: "forfeit", winnerSeat: 1 });
  });

  it("has no forfeit winner when both seats emptied", () => {
    const abandoned = snap({ phase: "over", reason: "forfeit", seats: [null, null] });
    expect(boardTableView(abandoned, "a").outcome).toEqual({ kind: "forfeit", winnerSeat: null });
  });
});

describe("boardTableView — canReplay (the play-again offer)", () => {
  const seated: [BoardOccupant, BoardOccupant] = [
    { ...alice, accepted: true },
    { ...bob, accepted: true },
  ];
  const finished = snap({
    phase: "over",
    reason: "win",
    seats: seated,
    state: { board: [1, 1, 1, 0, 0, 0, 0, 0, 0], turn: 1, result: { status: "won", winner: 1, line: [0, 1, 2] } },
  });

  it("is offered to both players of a finished match — winner and loser alike", () => {
    expect(boardTableView(finished, "a").canReplay).toBe(true);
    expect(boardTableView(finished, "b").canReplay).toBe(true);
  });

  it("is never offered to a spectator, who has no seat to replay from", () => {
    expect(boardTableView(finished, "watcher").canReplay).toBe(false);
  });

  it("is withheld after a forfeit: the opponent already left the table", () => {
    const forfeit = snap({ phase: "over", reason: "forfeit", seats: [null, seated[1]] });
    expect(boardTableView(forfeit, "b").canReplay).toBe(false);
  });

  it("is withheld while a match is still running or being offered", () => {
    expect(boardTableView(snap({ phase: "offer", seats: seated }), "a").canReplay).toBe(false);
    const live = snap({
      phase: "active",
      seats: seated,
      state: { board: board9(), turn: 1, result: { status: "in_progress" } },
    });
    expect(boardTableView(live, "a").canReplay).toBe(false);
  });
});
