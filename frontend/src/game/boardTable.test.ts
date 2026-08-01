import { describe, expect, it } from "vitest";
import type { BoardOccupant, BoardUpdatePayload } from "@metaverse/shared";
import {
  boardCells,
  boardSeatHolder,
  boardSeatOccupants,
  boardTableView,
  canTakeBoardSeat,
  cellRow,
  clickToMove,
  winLineStep,
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

// ── Animation inputs (issue #163) ───────────────────────────────────────────
// The panel's drop / draw-in / win-line motion is CSS, but the two numbers it
// keys off are decisions and therefore live in this pure module.

describe("boardCells", () => {
  it("returns the live board when a match is running", () => {
    const cells = [1, 0, 2, 0, 0, 0, 0, 0, 0] as const;
    const s = snap({
      phase: "active",
      state: { board: [...cells], turn: 1, result: { status: "in_progress" } },
    });
    expect(boardCells(s)).toEqual([...cells]);
  });

  it("zero-fills to the game's grid size when idle", () => {
    expect(boardCells(snap({ game: "tictactoe" }))).toHaveLength(9);
    expect(boardCells(snap({ game: "connect4" }))).toHaveLength(42);
    expect(boardCells(snap({ game: "connect4" })).every((c) => c === 0)).toBe(true);
  });
});

describe("cellRow (Connect-4 drop distance)", () => {
  const cases: Array<{ index: number; columns: number; row: number }> = [
    { index: 0, columns: 7, row: 0 },
    { index: 6, columns: 7, row: 0 },
    { index: 7, columns: 7, row: 1 },
    { index: 20, columns: 7, row: 2 },
    { index: 41, columns: 7, row: 5 },
    { index: 8, columns: 3, row: 2 },
  ];
  for (const { index, columns, row } of cases) {
    it(`cell ${index} on a ${columns}-wide grid is row ${row}`, () => {
      expect(cellRow(index, columns)).toBe(row);
    });
  }

  it("clamps degenerate input to row 0 instead of throwing", () => {
    expect(cellRow(-3, 7)).toBe(0);
    expect(cellRow(5, 0)).toBe(0);
    expect(cellRow(5, -1)).toBe(0);
  });
});

describe("winLineStep (win-line stagger)", () => {
  it("gives each winning cell its position along the line", () => {
    const line = [2, 5, 8];
    expect(winLineStep(line, 2)).toBe(0);
    expect(winLineStep(line, 5)).toBe(1);
    expect(winLineStep(line, 8)).toBe(2);
  });

  it("is null for cells outside the line (and for no line at all)", () => {
    expect(winLineStep([2, 5, 8], 4)).toBeNull();
    expect(winLineStep([], 0)).toBeNull();
  });

  it("matches the view's winning line end to end", () => {
    const won = snap({
      phase: "over",
      reason: "win",
      seats: [{ ...alice, accepted: true }, { ...bob, accepted: true }],
      state: {
        board: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        turn: 1,
        result: { status: "won", winner: 1, line: [0, 4, 8] },
      },
    });
    const view = boardTableView(won, "a");
    expect(view.cells.map((_, i) => winLineStep(view.winningLine, i))).toEqual([
      0, null, null, null, 1, null, null, null, 2,
    ]);
  });
});
