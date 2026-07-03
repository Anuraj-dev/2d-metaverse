import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pino } from "pino";
import type { BoardErrorPayload, BoardUpdatePayload } from "@metaverse/shared";
import { createBoardManager, type BoardManager } from "../src/board-manager.js";

/**
 * The manager is the side-effect shell around the pure machine (boardMatch.ts,
 * exhaustively tested separately): these tests cover what only the shell owns —
 * snapshot translation, the board-error reply on a rejected action, the
 * disconnect-grace forfeit timer, and Redis persist/clear signalling.
 */

const GRACE_MS = 300;
const TABLE = "ttt-1";

interface Persist {
  tableId: string;
  snapshot: BoardUpdatePayload | null;
}

function makeManager(): {
  manager: BoardManager;
  updates: BoardUpdatePayload[];
  errors: { playerId: string; payload: BoardErrorPayload }[];
  persists: Persist[];
} {
  const updates: BoardUpdatePayload[] = [];
  const errors: { playerId: string; payload: BoardErrorPayload }[] = [];
  const persists: Persist[] = [];
  const names: Record<string, string> = { a: "alice", b: "bob" };
  const manager = createBoardManager({
    graceMs: GRACE_MS,
    ttlSeconds: 3600,
    resolveName: (id) => names[id] ?? id,
    broadcast: (payload) => updates.push(payload),
    sendError: (playerId, payload) => errors.push({ playerId, payload }),
    persist: (tableId, snapshot) => persists.push({ tableId, snapshot }),
    log: pino({ level: "silent" }),
  });
  return { manager, updates, errors, persists };
}

describe("board manager", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("broadcasts an offer snapshot when both seats fill and persists it", async () => {
    const { manager, updates, persists } = makeManager();
    manager.dispatch(TABLE, { type: "sit", seat: 0, playerId: "a" });
    manager.dispatch(TABLE, { type: "sit", seat: 1, playerId: "b" });
    await manager.settle();

    const last = updates.at(-1);
    expect(last).toMatchObject({
      tableId: TABLE,
      game: "tictactoe",
      phase: "offer",
      seats: [
        { id: "a", name: "alice", accepted: false },
        { id: "b", name: "bob", accepted: false },
      ],
      state: null,
      reason: null,
    });
    // Non-idle snapshots are persisted (never null while occupied).
    expect(persists.at(-1)?.snapshot).not.toBeNull();
  });

  it("starts the match and carries a fresh board once both accept", async () => {
    const { manager, updates } = makeManager();
    manager.dispatch(TABLE, { type: "sit", seat: 0, playerId: "a" });
    manager.dispatch(TABLE, { type: "sit", seat: 1, playerId: "b" });
    manager.dispatch(TABLE, { type: "accept", playerId: "a" });
    manager.dispatch(TABLE, { type: "accept", playerId: "b" });
    await manager.settle();

    const last = updates.at(-1);
    expect(last?.phase).toBe("active");
    expect(last?.state?.turn).toBe(1);
    expect(last?.state?.board).toHaveLength(9);
  });

  it("replies with a board-error on a rejected move (no broadcast)", async () => {
    const { manager, errors, updates } = makeManager();
    const before = updates.length;
    manager.dispatch(TABLE, { type: "move", playerId: "a", index: 0 });
    await manager.settle();
    expect(errors).toEqual([{ playerId: "a", payload: { tableId: TABLE, reason: "no-match" } }]);
    expect(updates.length).toBe(before); // rejection does not broadcast
  });

  it("forfeits an active match after the grace window on disconnect and clears Redis when idle", async () => {
    const { manager, updates, persists } = makeManager();
    manager.dispatch(TABLE, { type: "sit", seat: 0, playerId: "a" });
    manager.dispatch(TABLE, { type: "sit", seat: 1, playerId: "b" });
    manager.dispatch(TABLE, { type: "accept", playerId: "a" });
    manager.dispatch(TABLE, { type: "accept", playerId: "b" });
    await manager.settle();

    manager.scheduleForfeit("a");
    await vi.advanceTimersByTimeAsync(GRACE_MS + 5);
    await manager.settle();

    expect(updates.at(-1)?.phase).toBe("over");
    expect(updates.at(-1)?.reason).toBe("forfeit");

    // The remaining player stands → table idle → Redis key cleared (null).
    manager.stand("b");
    await manager.settle();
    expect(persists.at(-1)).toEqual({ tableId: TABLE, snapshot: null });
  });

  it("a canceled forfeit does not fire", async () => {
    const { manager, updates } = makeManager();
    manager.dispatch(TABLE, { type: "sit", seat: 0, playerId: "a" });
    manager.dispatch(TABLE, { type: "sit", seat: 1, playerId: "b" });
    manager.dispatch(TABLE, { type: "accept", playerId: "a" });
    manager.dispatch(TABLE, { type: "accept", playerId: "b" });
    await manager.settle();
    const count = updates.length;

    manager.scheduleForfeit("a");
    manager.cancelForfeit("a");
    await vi.advanceTimersByTimeAsync(GRACE_MS + 5);
    await manager.settle();
    expect(updates.length).toBe(count); // still active, no forfeit broadcast
  });
});
