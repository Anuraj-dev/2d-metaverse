/**
 * Board-game tables at the socket seam (PRD 11 phase 2): the server validates
 * seat membership, turn order and move legality against the shared rules, and
 * broadcasts each authoritative snapshot to the board room. The match rules and
 * shell are unit-tested separately (test/boardMatch.test.ts, board-manager.test.ts);
 * these prove the real wiring — sockets, Redis persistence + TTL, and the
 * disconnect-grace forfeit (LEAVE_GRACE_MS is shrunk to 400ms by setup.ts).
 */
import { io, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { BoardErrorPayload, BoardUpdatePayload } from "@metaverse/shared";
import { redis } from "../../src/redis.js";
import { createPlayer, once, onceMatching, sleep, startServer, teardown, type TestServer } from "./helpers.js";

const LEAVE_GRACE_MS = Number(process.env.LEAVE_GRACE_MS);

let server: TestServer;
let base: string;
const liveSockets: ClientSocket[] = [];

function connect(token: string): ClientSocket {
  const socket = io(base, { transports: ["websocket"], auth: { token }, reconnection: false });
  liveSockets.push(socket);
  return socket;
}

interface Player {
  socket: ClientSocket;
  selfId: string;
}

async function joinPlayer(prefix: string): Promise<Player> {
  const user = await createPlayer(prefix);
  const socket = connect(user.token);
  await once(socket, "connect");
  const init = once<{ selfId: string }>(socket, "init");
  socket.emit("join", { spaceId: "1" });
  return { socket, selfId: (await init).selfId };
}

/** Wait for a board-update for `tableId` matching `predicate`. */
function board(
  player: Player,
  tableId: string,
  predicate: (u: BoardUpdatePayload) => boolean,
): Promise<BoardUpdatePayload> {
  return onceMatching<BoardUpdatePayload>(player.socket, "board-update", (u) => u.tableId === tableId && predicate(u));
}

function boardError(player: Player, tableId: string): Promise<BoardErrorPayload> {
  return onceMatching<BoardErrorPayload>(player.socket, "board-error", (e) => e.tableId === tableId);
}

/** Sit both players, accept, and return once the match is active. */
async function startMatch(tableId: string, a: Player, b: Player): Promise<void> {
  const offered = board(b, tableId, (u) => u.phase === "offer");
  a.socket.emit("board-sit", { tableId, seat: 0 });
  b.socket.emit("board-sit", { tableId, seat: 1 });
  await offered;
  const active = board(a, tableId, (u) => u.phase === "active");
  a.socket.emit("board-accept", { tableId });
  b.socket.emit("board-accept", { tableId });
  await active;
}

beforeAll(async () => {
  server = await startServer();
  base = server.baseUrl;
});

afterEach(async () => {
  for (const socket of liveSockets.splice(0)) socket.disconnect();
  // Let disconnect-grace forfeits settle so a table resets before the next test.
  await sleep(LEAVE_GRACE_MS + 150);
});

afterAll(async () => {
  await teardown(server);
});

describe("board tables — socket seam", () => {
  it("plays a full tic-tac-toe match to a win and persists match state in Redis with a TTL", async () => {
    const a = await joinPlayer("bwa");
    const b = await joinPlayer("bwb");
    await startMatch("ttt-1", a, b);

    // A live match is mirrored to Redis with a positive TTL.
    let ttl = -2;
    for (let i = 0; i < 20 && ttl <= 0; i += 1) {
      ttl = await redis.ttl("board:ttt-1");
      if (ttl <= 0) await sleep(20);
    }
    expect(ttl).toBeGreaterThan(0);

    // Seat 0 wins the top row: 0,1,2; seat 1 plays 3,4 between. Last move wins.
    const script: [Player, number][] = [
      [a, 0],
      [b, 3],
      [a, 1],
      [b, 4],
    ];
    for (const [player, index] of script) {
      const seen = board(player, "ttt-1", (u) => u.state?.board[index] === (player === a ? 1 : 2));
      player.socket.emit("board-move", { tableId: "ttt-1", index });
      await seen;
    }
    const over = board(a, "ttt-1", (u) => u.phase === "over");
    a.socket.emit("board-move", { tableId: "ttt-1", index: 2 });
    const final = await over;
    expect(final.reason).toBe("win");
    expect(final.state?.result).toMatchObject({ status: "won", winner: 1 });
  });

  it("rejects an out-of-turn move and an illegal (occupied-cell) move", async () => {
    const a = await joinPlayer("bra");
    const b = await joinPlayer("brb");
    await startMatch("ttt-1", a, b);

    // Seat 1 tries to move first → not-your-turn.
    const outOfTurn = boardError(b, "ttt-1");
    b.socket.emit("board-move", { tableId: "ttt-1", index: 0 });
    expect((await outOfTurn).reason).toBe("not-your-turn");

    // Seat 0 plays 0; seat 1 then tries the same occupied cell → illegal-move.
    const played = board(a, "ttt-1", (u) => u.state?.board[0] === 1);
    a.socket.emit("board-move", { tableId: "ttt-1", index: 0 });
    await played;
    const illegal = boardError(b, "ttt-1");
    b.socket.emit("board-move", { tableId: "ttt-1", index: 0 });
    expect((await illegal).reason).toBe("illegal-move");
  });

  it("forfeits to the opponent when a seated player disconnects past the grace window", async () => {
    const a = await joinPlayer("bfa");
    const b = await joinPlayer("bfb");
    await startMatch("ttt-1", a, b);

    const forfeit = board(b, "ttt-1", (u) => u.phase === "over");
    a.socket.disconnect();
    const result = await forfeit;
    expect(result.reason).toBe("forfeit");
    expect(result.seats[0]).toBeNull(); // the disconnected seat is emptied
    expect(result.seats[1]?.id).toBe(b.selfId);
  });

  it("plays a full tic-tac-toe match to a draw", async () => {
    const a = await joinPlayer("bda");
    const b = await joinPlayer("bdb");
    await startMatch("ttt-1", a, b);

    // A full board with no line: X O X / X O O / O X X.
    const script: [Player, number][] = [
      [a, 0],
      [b, 1],
      [a, 2],
      [b, 4],
      [a, 3],
      [b, 5],
      [a, 7],
      [b, 6],
    ];
    for (const [player, index] of script) {
      const seen = board(player, "ttt-1", (u) => u.state?.board[index] === (player === a ? 1 : 2));
      player.socket.emit("board-move", { tableId: "ttt-1", index });
      await seen;
    }
    const over = board(a, "ttt-1", (u) => u.phase === "over");
    a.socket.emit("board-move", { tableId: "ttt-1", index: 8 });
    expect((await over).reason).toBe("draw");
  });

  it("plays a Connect-4 match to a vertical win", async () => {
    const a = await joinPlayer("bca");
    const b = await joinPlayer("bcb");
    await startMatch("c4-1", a, b);

    // Seat 0 stacks column 0 four times; seat 1 answers in column 1.
    const script: [Player, number][] = [
      [a, 0],
      [b, 1],
      [a, 0],
      [b, 1],
      [a, 0],
      [b, 1],
    ];
    for (const [player, col] of script) {
      const seen = onceMatching<BoardUpdatePayload>(
        player.socket,
        "board-update",
        (u) => u.tableId === "c4-1" && u.phase === "active",
      );
      player.socket.emit("board-move", { tableId: "c4-1", index: col });
      await seen;
    }
    const over = board(a, "c4-1", (u) => u.phase === "over");
    a.socket.emit("board-move", { tableId: "c4-1", index: 0 });
    const final = await over;
    expect(final.reason).toBe("win");
    expect(final.state?.result).toMatchObject({ status: "won", winner: 1 });
  });
});
