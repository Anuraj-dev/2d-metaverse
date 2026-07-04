import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pino } from "pino";
import type { BoardErrorPayload, BoardGame, BoardUpdatePayload } from "@metaverse/shared";
import { createBoardManager, type BoardManager } from "../src/board-manager.js";

/**
 * The manager is the side-effect shell around the pure machine (boardMatch.ts,
 * exhaustively tested separately): these tests cover what only the shell owns —
 * snapshot translation, the board-error reply on a rejected action, the
 * disconnect-grace forfeit timer, Redis persist/clear signalling, per-space
 * isolation, the one-table-per-player invariant + full stand cleanup, and
 * Redis hydration on restart.
 */

const GRACE_MS = 300;
const TABLE = "ttt-1";
const C4 = "c4-1";
const SPACE = "space-1";
const SPACE_B = "space-2";

interface Broadcast {
  spaceId: string;
  payload: BoardUpdatePayload;
}
interface Persist {
  spaceId: string;
  tableId: string;
  snapshot: BoardUpdatePayload | null;
}

type Loader = (spaceId: string, tableId: string) => Promise<BoardUpdatePayload | null>;

function makeManager(load?: Loader): {
  manager: BoardManager;
  updates: Broadcast[];
  errors: { playerId: string; payload: BoardErrorPayload }[];
  persists: Persist[];
} {
  const updates: Broadcast[] = [];
  const errors: { playerId: string; payload: BoardErrorPayload }[] = [];
  const persists: Persist[] = [];
  const names: Record<string, string> = { a: "alice", b: "bob", c: "carol", d: "dave" };
  const manager = createBoardManager({
    graceMs: GRACE_MS,
    ttlSeconds: 3600,
    resolveName: (id) => names[id] ?? id,
    broadcast: (spaceId, payload) => updates.push({ spaceId, payload }),
    sendError: (playerId, payload) => errors.push({ playerId, payload }),
    persist: (spaceId, tableId, snapshot) => persists.push({ spaceId, tableId, snapshot }),
    load: load ?? (() => Promise.resolve(null)),
    log: pino({ level: "silent" }),
  });
  return { manager, updates, errors, persists };
}

/** A persisted active-match snapshot, for hydration/restart tests. */
function activeSnapshot(tableId: string, game: BoardGame, seat0: string, seat1: string): BoardUpdatePayload {
  const cells = game === "tictactoe" ? 9 : 42;
  return {
    tableId: tableId as BoardUpdatePayload["tableId"],
    game,
    phase: "active",
    seats: [
      { id: seat0, name: seat0, accepted: true },
      { id: seat1, name: seat1, accepted: true },
    ],
    state: { board: Array<0>(cells).fill(0), turn: 1, result: { status: "in_progress" } },
    reason: null,
  };
}

/**
 * A loader whose per-table hydration blocks until `release`d — used to hold a
 * `sit` suspended mid-hydration so cleanup / a second sit can overlap it. Tolerant
 * of release-before-load: a value released early resolves the load when it arrives.
 */
function deferredLoad(): {
  load: Loader;
  release: (spaceId: string, tableId: string, value?: BoardUpdatePayload | null) => void;
} {
  const pending = new Map<string, (v: BoardUpdatePayload | null) => void>();
  const early = new Map<string, BoardUpdatePayload | null>();
  const load: Loader = (spaceId, tableId) => {
    const key = `${spaceId}|${tableId}`;
    if (early.has(key)) return Promise.resolve(early.get(key) ?? null);
    return new Promise<BoardUpdatePayload | null>((resolve) => pending.set(key, resolve));
  };
  const release = (spaceId: string, tableId: string, value: BoardUpdatePayload | null = null): void => {
    const key = `${spaceId}|${tableId}`;
    const resolve = pending.get(key);
    if (resolve) resolve(value);
    else early.set(key, value);
  };
  return { load, release };
}

describe("board manager", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("broadcasts an offer snapshot when both seats fill and persists it", async () => {
    const { manager, updates, persists } = makeManager();
    manager.dispatch(SPACE, TABLE, { type: "sit", seat: 0, playerId: "a" });
    manager.dispatch(SPACE, TABLE, { type: "sit", seat: 1, playerId: "b" });
    await manager.settle();

    const last = updates.at(-1);
    expect(last?.spaceId).toBe(SPACE);
    expect(last?.payload).toMatchObject({
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
    expect(persists.at(-1)).toMatchObject({ spaceId: SPACE, tableId: TABLE });
  });

  it("starts the match and carries a fresh board once both accept", async () => {
    const { manager, updates } = makeManager();
    manager.dispatch(SPACE, TABLE, { type: "sit", seat: 0, playerId: "a" });
    manager.dispatch(SPACE, TABLE, { type: "sit", seat: 1, playerId: "b" });
    manager.dispatch(SPACE, TABLE, { type: "accept", playerId: "a" });
    manager.dispatch(SPACE, TABLE, { type: "accept", playerId: "b" });
    await manager.settle();

    const last = updates.at(-1)?.payload;
    expect(last?.phase).toBe("active");
    expect(last?.state?.turn).toBe(1);
    expect(last?.state?.board).toHaveLength(9);
  });

  it("replies with a board-error on a rejected move (no broadcast)", async () => {
    const { manager, errors, updates } = makeManager();
    const before = updates.length;
    manager.dispatch(SPACE, TABLE, { type: "move", playerId: "a", index: 0 });
    await manager.settle();
    expect(errors).toEqual([{ playerId: "a", payload: { tableId: TABLE, reason: "no-match" } }]);
    expect(updates.length).toBe(before); // rejection does not broadcast
  });

  it("forfeits an active match after the grace window on disconnect and clears Redis when idle", async () => {
    const { manager, updates, persists } = makeManager();
    manager.dispatch(SPACE, TABLE, { type: "sit", seat: 0, playerId: "a" });
    manager.dispatch(SPACE, TABLE, { type: "sit", seat: 1, playerId: "b" });
    manager.dispatch(SPACE, TABLE, { type: "accept", playerId: "a" });
    manager.dispatch(SPACE, TABLE, { type: "accept", playerId: "b" });
    await manager.settle();

    manager.scheduleForfeit(SPACE, "a");
    await vi.advanceTimersByTimeAsync(GRACE_MS + 5);
    await manager.settle();

    expect(updates.at(-1)?.payload.phase).toBe("over");
    expect(updates.at(-1)?.payload.reason).toBe("forfeit");

    // The remaining player stands → table idle → Redis key cleared (null).
    manager.stand(SPACE, "b");
    await manager.settle();
    expect(persists.at(-1)).toEqual({ spaceId: SPACE, tableId: TABLE, snapshot: null });
  });

  it("a canceled forfeit does not fire", async () => {
    const { manager, updates } = makeManager();
    manager.dispatch(SPACE, TABLE, { type: "sit", seat: 0, playerId: "a" });
    manager.dispatch(SPACE, TABLE, { type: "sit", seat: 1, playerId: "b" });
    manager.dispatch(SPACE, TABLE, { type: "accept", playerId: "a" });
    manager.dispatch(SPACE, TABLE, { type: "accept", playerId: "b" });
    await manager.settle();
    const count = updates.length;

    manager.scheduleForfeit(SPACE, "a");
    manager.cancelForfeit("a");
    await vi.advanceTimersByTimeAsync(GRACE_MS + 5);
    await manager.settle();
    expect(updates.length).toBe(count); // still active, no forfeit broadcast
  });

  it("isolates the same table id across spaces", async () => {
    const { manager, updates } = makeManager();
    // Same table id, two different spaces — must be fully independent.
    manager.dispatch(SPACE, TABLE, { type: "sit", seat: 0, playerId: "a" });
    manager.dispatch(SPACE_B, TABLE, { type: "sit", seat: 0, playerId: "c" });
    await manager.settle();

    const inA = await manager.currentSnapshot(SPACE, TABLE);
    const inB = await manager.currentSnapshot(SPACE_B, TABLE);
    expect(inA?.seats[0]?.id).toBe("a");
    expect(inA?.seats[1]).toBeNull();
    expect(inB?.seats[0]?.id).toBe("c");
    expect(inB?.seats[1]).toBeNull();

    // Every broadcast was tagged with the originating space only.
    expect(updates.filter((u) => u.spaceId === SPACE).every((u) => u.payload.seats[0]?.id === "a")).toBe(true);
    expect(updates.filter((u) => u.spaceId === SPACE_B).every((u) => u.payload.seats[0]?.id === "c")).toBe(true);
  });

  it("rejects sitting at a second table while already seated at another", async () => {
    const { manager, errors } = makeManager();
    manager.dispatch(SPACE, TABLE, { type: "sit", seat: 0, playerId: "a" });
    await manager.settle();
    // Same player tries to also take a seat at a different table in the space.
    manager.dispatch(SPACE, C4, { type: "sit", seat: 0, playerId: "a" });
    await manager.settle();

    expect(errors).toContainEqual({ playerId: "a", payload: { tableId: C4, reason: "seat-taken" } });
    const c4 = await manager.currentSnapshot(SPACE, C4);
    expect(c4?.seats[0]).toBeNull(); // never seated at the second table
    const ttt = await manager.currentSnapshot(SPACE, TABLE);
    expect(ttt?.seats[0]?.id).toBe("a"); // still holds the first
  });

  it("stand cleans up every table a player holds (no stranded seat/Redis key)", async () => {
    // Seed two active matches for the same player via hydration (the invariant
    // prevents reaching this state through normal sits, so this exercises the
    // belt-and-suspenders cleanup directly).
    const load: Loader = (spaceId, tableId) => {
      if (spaceId !== SPACE) return Promise.resolve(null);
      if (tableId === TABLE) return Promise.resolve(activeSnapshot(TABLE, "tictactoe", "a", "b"));
      if (tableId === C4) return Promise.resolve(activeSnapshot(C4, "connect4", "a", "c"));
      return Promise.resolve(null);
    };
    const { manager, persists } = makeManager(load);
    // Touch both tables so they hydrate the player into two seats.
    expect((await manager.currentSnapshot(SPACE, TABLE))?.seats[0]?.id).toBe("a");
    expect((await manager.currentSnapshot(SPACE, C4))?.seats[0]?.id).toBe("a");

    manager.stand(SPACE, "a");
    await manager.settle();

    // Both matches forfeited (empty seat left), neither stranded.
    const ttt = await manager.currentSnapshot(SPACE, TABLE);
    const c4 = await manager.currentSnapshot(SPACE, C4);
    expect(ttt?.phase).toBe("over");
    expect(ttt?.seats[0]).toBeNull();
    expect(c4?.phase).toBe("over");
    expect(c4?.seats[0]).toBeNull();
    // A persist was written for each table (forfeit snapshot, not stranded).
    expect(persists.some((p) => p.tableId === TABLE)).toBe(true);
    expect(persists.some((p) => p.tableId === C4)).toBe(true);
  });

  it("hydrates a persisted match on first access (survives a restart)", async () => {
    const load: Loader = (spaceId, tableId) =>
      Promise.resolve(spaceId === SPACE && tableId === TABLE ? activeSnapshot(TABLE, "tictactoe", "a", "b") : null);
    const { manager } = makeManager(load);

    // Fresh runtime (as after a restart) reflects the persisted live match.
    const snap = await manager.currentSnapshot(SPACE, TABLE);
    expect(snap?.phase).toBe("active");
    expect(snap?.seats.map((s) => s?.id)).toEqual(["a", "b"]);

    // And it accepts play against the hydrated board — a's move (mark 1) lands.
    manager.dispatch(SPACE, TABLE, { type: "move", playerId: "a", index: 0 });
    await manager.settle();
    const afterMove = await manager.currentSnapshot(SPACE, TABLE);
    expect(afterMove?.state?.board[0]).toBe(1);
    expect(afterMove?.state?.turn).toBe(2);
  });

  // --- Concurrency: with one queue per space, every board event in a space is
  // totally ordered, so the one-table-per-player invariant, same-table event order,
  // and cleanup are all atomic within the space. ---

  it("two overlapping sits to different tables — exactly one wins", async () => {
    // NOTE: not discriminating on its own — a per-table check→commit is already
    // atomic single-threaded, so this held for the old design too. It guards the
    // invariant holds when both sits are in flight; the same-table ordering and
    // cleanup tests below are the ones that fail against the earlier split queues.
    const gate = deferredLoad();
    const { manager, errors } = makeManager(gate.load);
    // Both sits are dispatched before either commits (each blocks in hydration).
    manager.dispatch(SPACE, TABLE, { type: "sit", seat: 0, playerId: "a" });
    manager.dispatch(SPACE, C4, { type: "sit", seat: 0, playerId: "a" });
    gate.release(SPACE, TABLE);
    gate.release(SPACE, C4);
    await manager.settle();

    const seatedAt = [
      (await manager.currentSnapshot(SPACE, TABLE))?.seats[0]?.id,
      (await manager.currentSnapshot(SPACE, C4))?.seats[0]?.id,
    ].filter((id) => id === "a");
    expect(seatedAt).toHaveLength(1); // never seated at both
    // The second (C4, enqueued after the TABLE sit) is the one rejected.
    expect(errors).toContainEqual({ playerId: "a", payload: { tableId: C4, reason: "seat-taken" } });
  });

  it("two overlapping sits to the SAME seat — one is seated, the other is rejected", async () => {
    // The core seat-exclusivity guard: with both sits in flight the space queue
    // serializes them, so exactly one player lands on the seat and the loser gets
    // an authoritative seat-taken rejection (never a silent overwrite / double-seat).
    const gate = deferredLoad();
    const { manager, errors } = makeManager(gate.load);
    manager.dispatch(SPACE, TABLE, { type: "sit", seat: 0, playerId: "a" });
    manager.dispatch(SPACE, TABLE, { type: "sit", seat: 0, playerId: "b" });
    gate.release(SPACE, TABLE);
    await manager.settle();

    const seat0 = (await manager.currentSnapshot(SPACE, TABLE))?.seats[0]?.id;
    expect(seat0).toBe("a"); // first sit wins; b never overwrites it
    // The second sitter (b, enqueued behind a) is the one rejected.
    expect(errors).toContainEqual({ playerId: "b", payload: { tableId: TABLE, reason: "seat-taken" } });
    expect(errors.some((e) => e.playerId === "a")).toBe(false);
  });

  it("same-table move, move, stand apply in arrival order — the second move still commits", async () => {
    const { manager, updates } = makeManager();
    // Active match: a = seat 0 (mark 1, moves first), b = seat 1 (mark 2).
    manager.dispatch(SPACE, TABLE, { type: "sit", seat: 0, playerId: "a" });
    manager.dispatch(SPACE, TABLE, { type: "sit", seat: 1, playerId: "b" });
    manager.dispatch(SPACE, TABLE, { type: "accept", playerId: "a" });
    manager.dispatch(SPACE, TABLE, { type: "accept", playerId: "b" });
    await manager.settle();

    // a moves, b's move is dispatched, then a stands — all before settling. Under
    // the earlier split (moves per-table, stand per-space) the stand could overtake
    // b's queued move, forfeit first, and reject b's move as "no-match" (board[1]
    // never set). With one space queue the arrival order holds: both moves commit,
    // THEN the forfeit.
    manager.dispatch(SPACE, TABLE, { type: "move", playerId: "a", index: 0 });
    manager.dispatch(SPACE, TABLE, { type: "move", playerId: "b", index: 1 });
    manager.stand(SPACE, "a");
    await manager.settle();

    const last = updates.at(-1)?.payload;
    expect(last?.phase).toBe("over");
    expect(last?.reason).toBe("forfeit");
    expect(last?.state?.board[0]).toBe(1); // a's move committed
    expect(last?.state?.board[1]).toBe(2); // b's move committed BEFORE the forfeit
  });

  it("cleanup never strands a sit still queued behind hydration", async () => {
    const gate = deferredLoad();
    const { manager, persists } = makeManager(gate.load);
    // The sit is queued but suspended in hydration (Redis load not resolved yet)…
    manager.dispatch(SPACE, TABLE, { type: "sit", seat: 0, playerId: "a" });
    // …when the player disconnects and cleanup fires. Under per-table queues the
    // scan would miss the uncommitted sit and the seat would leak; the single
    // space queue orders cleanup strictly after the sit commits.
    manager.stand(SPACE, "a");
    gate.release(SPACE, TABLE);
    await manager.settle();

    const ttt = await manager.currentSnapshot(SPACE, TABLE);
    expect(ttt?.seats[0]).toBeNull(); // seat freed, not stranded
    expect(ttt?.phase).toBe("waiting");
    // The Redis mirror was cleared (idle), not left holding a ghost occupant.
    expect(persists.at(-1)).toEqual({ spaceId: SPACE, tableId: TABLE, snapshot: null });
  });
});
