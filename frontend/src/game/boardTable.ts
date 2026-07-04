/**
 * Board-table view logic — pure: plain values in, plain values out; no Phaser,
 * net, or DOM. Maps an authoritative {@link BoardUpdatePayload} snapshot + the
 * viewer's id onto everything the HUD panel needs to render (grid shape, whose
 * turn, offer prompt, status line, spectator display) and how a grid click maps
 * to a move index. The panel stays a thin renderer; all decisions live here.
 */
import {
  CONNECT4_COLS,
  CONNECT4_ROWS,
  TICTACTOE_SIZE,
  type BoardGame,
  type BoardMatchPhase,
  type BoardUpdatePayload,
} from "@metaverse/shared";

export interface BoardTableView {
  tableId: string;
  game: BoardGame;
  phase: BoardMatchPhase;
  /** The viewer's seat (0 or 1), or null when spectating. */
  mySeat: 0 | 1 | null;
  spectating: boolean;
  columns: number;
  rows: number;
  /** Flat row-major cells (0 empty, 1 seat-0, 2 seat-1); zero-filled when idle. */
  cells: readonly number[];
  /** Winning cell indices to highlight, or empty. */
  winningLine: readonly number[];
  /** The offer needs the viewer's acceptance. */
  canAccept: boolean;
  /** The viewer may play a move right now (their turn in an active match). */
  interactive: boolean;
  /** One-line status shown above the board. */
  status: string;
  /** Seat display names by index (null when empty). */
  seatNames: [string | null, string | null];
}

/** Seat occupant ids for a table snapshot, by seat index (null when empty). */
export type BoardSeatOccupants = readonly [string | null, string | null];

/** Extract the occupant ids of a snapshot's two seats. */
export function boardSeatOccupants(snapshot: BoardUpdatePayload): BoardSeatOccupants {
  return [snapshot.seats[0]?.id ?? null, snapshot.seats[1]?.id ?? null];
}

/** The id holding `seat`, or null (also null for any out-of-range seat index). */
export function boardSeatHolder(occupants: BoardSeatOccupants, seat: number): string | null {
  if (seat === 0) return occupants[0];
  if (seat === 1) return occupants[1];
  return null;
}

/**
 * May `selfId` sit on `seat`? True only when the seat is empty or already theirs
 * (re-sit is a no-op). A seat held by ANY other player is not takeable — this is
 * the client-side prevention mirror of the server's authoritative `seat-taken`
 * rejection, so a taken board seat is never offered.
 */
export function canTakeBoardSeat(
  occupants: BoardSeatOccupants,
  seat: number,
  selfId: string,
): boolean {
  const holder = boardSeatHolder(occupants, seat);
  return holder === null || holder === selfId;
}

function gridSize(game: BoardGame): { columns: number; rows: number } {
  return game === "connect4"
    ? { columns: CONNECT4_COLS, rows: CONNECT4_ROWS }
    : { columns: TICTACTOE_SIZE, rows: TICTACTOE_SIZE };
}

/** Maps a clicked grid cell to a move index: a cell (TTT) or its column (C4). */
export function clickToMove(game: BoardGame, cellIndex: number): number {
  if (game === "connect4") return cellIndex % CONNECT4_COLS;
  return cellIndex;
}

function statusFor(snapshot: BoardUpdatePayload, mySeat: 0 | 1 | null): string {
  const names = snapshot.seats.map((s) => s?.name ?? null);
  const other = mySeat === null ? null : names[mySeat === 0 ? 1 : 0];
  switch (snapshot.phase) {
    case "waiting":
      return names[0] && names[1] ? "Starting…" : "Waiting for a second player";
    case "offer": {
      if (mySeat === null) return "Players are getting ready";
      const mine = snapshot.seats[mySeat];
      return mine?.accepted ? "Waiting for your opponent to accept" : "Accept to start the match";
    }
    case "active": {
      const turnSeat = snapshot.state ? snapshot.state.turn - 1 : 0;
      if (mySeat === null) return `${names[turnSeat] ?? "Player"} to move`;
      return turnSeat === mySeat ? "Your turn" : `Waiting for ${other ?? "your opponent"}`;
    }
    case "over": {
      const result = snapshot.state?.result;
      if (snapshot.reason === "forfeit") {
        // Forfeit empties the leaver's seat, so anyone still seated is the winner.
        if (mySeat !== null) return "Opponent left — you win!";
        const winnerSeat = snapshot.seats[0] ? 0 : snapshot.seats[1] ? 1 : null;
        return `${winnerSeat !== null ? names[winnerSeat] ?? "Player" : "A player"} wins by forfeit`;
      }
      if (result?.status === "draw") return "Draw";
      if (result?.status === "won") {
        const winnerSeat = result.winner - 1;
        if (mySeat !== null) return winnerSeat === mySeat ? "You win!" : "You lose";
        return `${names[winnerSeat] ?? "Player"} wins`;
      }
      return "Match over";
    }
  }
}

/** Build the render/interaction view of a table for a given viewer. */
export function boardTableView(snapshot: BoardUpdatePayload, selfId: string): BoardTableView {
  const mySeat: 0 | 1 | null =
    snapshot.seats[0]?.id === selfId ? 0 : snapshot.seats[1]?.id === selfId ? 1 : null;
  const { columns, rows } = gridSize(snapshot.game);
  const cells = snapshot.state?.board ?? Array<number>(columns * rows).fill(0);
  const winningLine = snapshot.state?.result.status === "won" ? snapshot.state.result.line : [];

  const canAccept =
    snapshot.phase === "offer" && mySeat !== null && snapshot.seats[mySeat]?.accepted === false;
  const interactive =
    snapshot.phase === "active" &&
    mySeat !== null &&
    snapshot.state !== null &&
    snapshot.state.turn - 1 === mySeat;

  return {
    tableId: snapshot.tableId,
    game: snapshot.game,
    phase: snapshot.phase,
    mySeat,
    spectating: mySeat === null,
    columns,
    rows,
    cells,
    winningLine,
    canAccept,
    interactive,
    status: statusFor(snapshot, mySeat),
    seatNames: [snapshot.seats[0]?.name ?? null, snapshot.seats[1]?.name ?? null],
  };
}
