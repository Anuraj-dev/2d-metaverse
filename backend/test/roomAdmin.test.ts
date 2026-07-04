import { describe, expect, it } from "vitest";
import {
  EMPTY_ROOM,
  atCapacity,
  roomAdminTransition,
  type RoomAdminConfig,
  type RoomAdminEvent,
  type RoomAdminState,
} from "../src/roomAdmin.js";

/**
 * Exhaustive transition matrix for the room-access state machine (PRD 14) — the
 * single place the admin / knock / capacity rules live (see CLAUDE.md). Written
 * from the PRD spec BEFORE any socket wiring, including illegal transitions:
 *   - approve/deny/toggle by a non-admin
 *   - approve an unknown knocker
 *   - knock while already inside
 *   - knock at capacity, allow-all at capacity, approve at capacity
 *   - admin succession (mid-list leave and last-leaver reset)
 */

const cap = (capacity: number): RoomAdminConfig => ({ capacity });
const state = (s: Partial<RoomAdminState>): RoomAdminState => ({ ...EMPTY_ROOM, ...s });

const knock = (playerId: string): RoomAdminEvent => ({ type: "knock", playerId });
const approve = (by: string, playerId: string): RoomAdminEvent => ({ type: "approve", by, playerId });
const deny = (by: string, playerId: string): RoomAdminEvent => ({ type: "deny", by, playerId });
const cancel = (playerId: string): RoomAdminEvent => ({ type: "cancel-knock", playerId });
const timeout = (playerId: string): RoomAdminEvent => ({ type: "knock-timeout", playerId });
const leave = (playerId: string): RoomAdminEvent => ({ type: "leave", playerId });
const toggle = (by: string, value: boolean): RoomAdminEvent => ({ type: "toggle-allow-all", by, value });

describe("atCapacity", () => {
  it("is true only when occupancy reaches capacity", () => {
    expect(atCapacity(state({ occupants: ["a"] }), cap(2))).toBe(false);
    expect(atCapacity(state({ occupants: ["a", "b"] }), cap(2))).toBe(true);
    expect(atCapacity(EMPTY_ROOM, cap(1))).toBe(false);
    expect(atCapacity(state({ occupants: ["a"] }), cap(1))).toBe(true);
  });
});

describe("knock into an empty room", () => {
  it("makes the first knocker the admin and admits them", () => {
    const r = roomAdminTransition(EMPTY_ROOM, knock("a"), cap(5));
    expect(r.state).toEqual(state({ admin: "a", occupants: ["a"] }));
    expect(r.effects).toEqual([
      { type: "admit", playerId: "a", asAdmin: true },
      { type: "admin-changed", admin: "a", reason: "initial" },
    ]);
  });

  it("emits room-open-state only if the single admit already fills a capacity-1 room", () => {
    const r = roomAdminTransition(EMPTY_ROOM, knock("a"), cap(1));
    expect(r.effects).toContainEqual({ type: "room-open-state", allowAll: false, atCapacity: true });
  });
});

describe("knock in knock mode (room has an admin)", () => {
  const room = state({ admin: "a", occupants: ["a"] });

  it("registers a pending knock and arms its timer", () => {
    const r = roomAdminTransition(room, knock("b"), cap(5));
    expect(r.state).toEqual(state({ admin: "a", occupants: ["a"], knocks: ["b"] }));
    expect(r.effects).toEqual([
      { type: "knocks-changed", knocks: ["b"] },
      { type: "knock-registered", playerId: "b" },
    ]);
  });

  it("ignores a knock from someone already inside (illegal)", () => {
    const r = roomAdminTransition(room, knock("a"), cap(5));
    expect(r).toEqual({ state: room, effects: [] });
  });

  it("ignores a duplicate knock from a pending knocker", () => {
    const pending = state({ admin: "a", occupants: ["a"], knocks: ["b"] });
    const r = roomAdminTransition(pending, knock("b"), cap(5));
    expect(r).toEqual({ state: pending, effects: [] });
  });

  it("appends a second knocker preserving knock order", () => {
    const pending = state({ admin: "a", occupants: ["a"], knocks: ["b"] });
    const r = roomAdminTransition(pending, knock("c"), cap(5));
    expect(r.state.knocks).toEqual(["b", "c"]);
  });

  it("turns a knocker away at capacity (no pending request)", () => {
    const full = state({ admin: "a", occupants: ["a", "b"] });
    const r = roomAdminTransition(full, knock("c"), cap(2));
    expect(r.state).toEqual(full);
    expect(r.effects).toEqual([{ type: "capacity-alert", playerId: "c" }]);
  });
});

describe("approve", () => {
  const pending = state({ admin: "a", occupants: ["a"], knocks: ["b"] });

  it("admits the approved knocker and clears them from the queue", () => {
    const r = roomAdminTransition(pending, approve("a", "b"), cap(5));
    expect(r.state).toEqual(state({ admin: "a", occupants: ["a", "b"], knocks: [] }));
    expect(r.effects).toEqual([
      { type: "knocks-changed", knocks: [] },
      { type: "admit", playerId: "b", asAdmin: false },
    ]);
  });

  it("keeps other pending knockers in the queue", () => {
    const two = state({ admin: "a", occupants: ["a"], knocks: ["b", "c"] });
    const r = roomAdminTransition(two, approve("a", "b"), cap(5));
    expect(r.state.knocks).toEqual(["c"]);
  });

  it("is inert when a non-admin tries to approve (illegal)", () => {
    const r = roomAdminTransition(pending, approve("z", "b"), cap(5));
    expect(r).toEqual({ state: pending, effects: [] });
  });

  it("is inert when approving an unknown knocker (illegal)", () => {
    const r = roomAdminTransition(pending, approve("a", "zzz"), cap(5));
    expect(r).toEqual({ state: pending, effects: [] });
  });

  it("blocks approval at capacity, keeping the knock pending and alerting the admin", () => {
    const full = state({ admin: "a", occupants: ["a", "x"], knocks: ["b"] });
    const r = roomAdminTransition(full, approve("a", "b"), cap(2));
    expect(r.state).toEqual(full);
    expect(r.effects).toEqual([{ type: "capacity-alert", playerId: "a" }]);
  });
});

describe("deny / cancel / timeout resolve a knock", () => {
  const pending = state({ admin: "a", occupants: ["a"], knocks: ["b", "c"] });

  it("denies a knock (admin only)", () => {
    const r = roomAdminTransition(pending, deny("a", "b"), cap(5));
    expect(r.state.knocks).toEqual(["c"]);
    expect(r.effects).toEqual([
      { type: "knocks-changed", knocks: ["c"] },
      { type: "knock-resolved", playerId: "b", result: "denied" },
    ]);
  });

  it("ignores a deny by a non-admin (illegal)", () => {
    expect(roomAdminTransition(pending, deny("z", "b"), cap(5))).toEqual({ state: pending, effects: [] });
  });

  it("lets a knocker cancel their own pending knock", () => {
    const r = roomAdminTransition(pending, cancel("b"), cap(5));
    expect(r.state.knocks).toEqual(["c"]);
    expect(r.effects).toEqual([
      { type: "knocks-changed", knocks: ["c"] },
      { type: "knock-resolved", playerId: "b", result: "canceled" },
    ]);
  });

  it("resolves a knock as timeout when its timer fires", () => {
    const r = roomAdminTransition(pending, timeout("c"), cap(5));
    expect(r.state.knocks).toEqual(["b"]);
    expect(r.effects).toEqual([
      { type: "knocks-changed", knocks: ["b"] },
      { type: "knock-resolved", playerId: "c", result: "timeout" },
    ]);
  });

  it("ignores a stale timeout for an already-resolved knock", () => {
    expect(roomAdminTransition(pending, timeout("gone"), cap(5))).toEqual({ state: pending, effects: [] });
  });
});

describe("leave & admin succession", () => {
  it("promotes the longest-tenured occupant when the admin leaves", () => {
    const room = state({ admin: "a", occupants: ["a", "b", "c"] });
    const r = roomAdminTransition(room, leave("a"), cap(5));
    expect(r.state).toEqual(state({ admin: "b", occupants: ["b", "c"] }));
    expect(r.effects).toEqual([{ type: "admin-changed", admin: "b", reason: "succession" }]);
  });

  it("does not change admin when a non-admin occupant leaves", () => {
    const room = state({ admin: "a", occupants: ["a", "b", "c"] });
    const r = roomAdminTransition(room, leave("b"), cap(5));
    expect(r.state).toEqual(state({ admin: "a", occupants: ["a", "c"] }));
    expect(r.effects).toEqual([]);
  });

  it("resets the room to a fresh empty session when the last occupant leaves", () => {
    const room = state({ admin: "a", occupants: ["a"], allowAll: true });
    const r = roomAdminTransition(room, leave("a"), cap(5));
    expect(r.state).toEqual(EMPTY_ROOM);
    expect(r.effects).toContainEqual({ type: "admin-changed", admin: null, reason: "succession" });
    // allow-all was on, so the door must reappear closed.
    expect(r.effects).toContainEqual({ type: "room-open-state", allowAll: false, atCapacity: false });
  });

  it("rejects pending knocks when the room empties", () => {
    const room = state({ admin: "a", occupants: ["a"], knocks: ["b", "c"] });
    const r = roomAdminTransition(room, leave("a"), cap(5));
    expect(r.state).toEqual(EMPTY_ROOM);
    expect(r.effects).toContainEqual({ type: "knock-resolved", playerId: "b", result: "denied" });
    expect(r.effects).toContainEqual({ type: "knock-resolved", playerId: "c", result: "denied" });
    expect(r.effects).toContainEqual({ type: "knocks-changed", knocks: [] });
  });

  it("withdraws a pending knock when the knocker leaves (disconnect)", () => {
    const room = state({ admin: "a", occupants: ["a"], knocks: ["b"] });
    const r = roomAdminTransition(room, leave("b"), cap(5));
    expect(r.state.knocks).toEqual([]);
    expect(r.effects).toEqual([
      { type: "knocks-changed", knocks: [] },
      { type: "knock-resolved", playerId: "b", result: "canceled" },
    ]);
  });

  it("ignores a leave by someone neither seated nor knocking", () => {
    const room = state({ admin: "a", occupants: ["a"] });
    expect(roomAdminTransition(room, leave("z"), cap(5))).toEqual({ state: room, effects: [] });
  });

  it("reopens the door when a leave frees a slot in a full allow-all room", () => {
    const room = state({ admin: "a", occupants: ["a", "b"], allowAll: true });
    const r = roomAdminTransition(room, leave("b"), cap(2));
    expect(r.effects).toContainEqual({ type: "room-open-state", allowAll: true, atCapacity: false });
  });
});

describe("allow-all toggle", () => {
  it("hides the door when turned on below capacity", () => {
    const room = state({ admin: "a", occupants: ["a"] });
    const r = roomAdminTransition(room, toggle("a", true), cap(5));
    expect(r.state.allowAll).toBe(true);
    expect(r.effects).toEqual([{ type: "room-open-state", allowAll: true, atCapacity: false }]);
  });

  it("is inert when a non-admin toggles (illegal)", () => {
    const room = state({ admin: "a", occupants: ["a"] });
    expect(roomAdminTransition(room, toggle("z", true), cap(5))).toEqual({ state: room, effects: [] });
  });

  it("is idempotent when the value is unchanged", () => {
    const room = state({ admin: "a", occupants: ["a"], allowAll: true });
    expect(roomAdminTransition(room, toggle("a", true), cap(5))).toEqual({ state: room, effects: [] });
  });

  it("admits pending knockers up to capacity and rejects the overflow", () => {
    const room = state({ admin: "a", occupants: ["a"], knocks: ["b", "c", "d"] });
    const r = roomAdminTransition(room, toggle("a", true), cap(3));
    expect(r.state).toEqual(state({ admin: "a", occupants: ["a", "b", "c"], knocks: [], allowAll: true }));
    expect(r.effects).toContainEqual({ type: "admit", playerId: "b", asAdmin: false });
    expect(r.effects).toContainEqual({ type: "admit", playerId: "c", asAdmin: false });
    expect(r.effects).toContainEqual({ type: "knock-resolved", playerId: "d", result: "denied" });
    expect(r.effects).toContainEqual({ type: "knocks-changed", knocks: [] });
    // room reached capacity, so the door stays visible (open ∧ full).
    expect(r.effects).toContainEqual({ type: "room-open-state", allowAll: true, atCapacity: true });
  });

  it("turning allow-all on at capacity rejects all pending knocks", () => {
    const room = state({ admin: "a", occupants: ["a", "b"], knocks: ["c"] });
    const r = roomAdminTransition(room, toggle("a", true), cap(2));
    expect(r.state).toEqual(state({ admin: "a", occupants: ["a", "b"], knocks: [], allowAll: true }));
    expect(r.effects).toContainEqual({ type: "knock-resolved", playerId: "c", result: "denied" });
  });

  it("turning allow-all off just closes the door", () => {
    const room = state({ admin: "a", occupants: ["a"], allowAll: true });
    const r = roomAdminTransition(room, toggle("a", false), cap(5));
    expect(r.state.allowAll).toBe(false);
    expect(r.effects).toEqual([{ type: "room-open-state", allowAll: false, atCapacity: false }]);
  });
});

describe("purity", () => {
  it("never mutates the input state", () => {
    const room = state({ admin: "a", occupants: ["a", "b"], knocks: ["c"] });
    roomAdminTransition(room, approve("a", "c"), cap(5));
    roomAdminTransition(room, leave("a"), cap(5));
    roomAdminTransition(room, toggle("a", true), cap(5));
    expect(room).toEqual(state({ admin: "a", occupants: ["a", "b"], knocks: ["c"] }));
  });
});

describe("full scenario: knock → approve → enter, then admin leaves", () => {
  const run = (steps: RoomAdminEvent[], config: RoomAdminConfig): { state: RoomAdminState; log: string[] } => {
    let s = EMPTY_ROOM;
    const log: string[] = [];
    for (const event of steps) {
      const r = roomAdminTransition(s, event, config);
      s = r.state;
      log.push(...r.effects.map((e) => e.type));
    }
    return { state: s, log };
  };

  it("admin admits a knocker, then hands off on leave", () => {
    const { state: s, log } = run([knock("a"), knock("b"), approve("a", "b"), leave("a")], cap(5));
    expect(s).toEqual(state({ admin: "b", occupants: ["b"] }));
    expect(log).toEqual([
      "admit", // a becomes admin
      "admin-changed",
      "knocks-changed", // b knocks
      "knock-registered",
      "knocks-changed", // b approved
      "admit",
      "admin-changed", // succession to b
    ]);
  });

  it("knock then timeout leaves the room with only the admin", () => {
    const { state: s, log } = run([knock("a"), knock("b"), timeout("b")], cap(5));
    expect(s).toEqual(state({ admin: "a", occupants: ["a"] }));
    expect(log).toContain("knock-resolved");
  });
});
