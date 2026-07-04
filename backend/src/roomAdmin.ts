/**
 * Room-access trigger state machine (PRD 14) — THE single place the room
 * admin / knock / capacity rules live (referenced from CLAUDE.md). Pure: plain
 * values in, plain values out; no io, no Redis, no timers. The manager shell
 * (room-admin-manager.ts) owns the side effects (knock-timeout timers, the
 * room-access grant write, room- and space-scoped broadcasts, Redis mirror) and
 * feeds events + a per-room capacity through {@link roomAdminTransition}.
 *
 * Rules (PRD 14):
 *   - The first player to knock at an EMPTY room walks straight in and becomes
 *     its admin (no password). Adminship is per-live-session only.
 *   - A later arrival's knock waits as a pending request; the admin approves or
 *     denies (Google-Meet model). A knock unanswered ~30s times out as denied.
 *   - When the admin leaves (or disconnects past grace), adminship passes to the
 *     longest-tenured remaining occupant — occupants[0] (Free-Fire succession).
 *     The last occupant leaving resets the room to a fresh empty session.
 *   - The admin can toggle "allow all": while on, knocks are admitted
 *     automatically (up to capacity) and the door visually disappears; at
 *     capacity the door reappears and entry is blocked until a slot frees.
 *   - Capacity is enforced HERE regardless of the door visuals — a malicious
 *     client cannot exceed it, self-promote, forge an approval, or bypass a
 *     knock, because every decision is derived from this machine's state.
 *
 * Invariant: `admin === occupants[0] ?? null` after every transition.
 */

/** How adminship was conferred, for the promotion notification. */
export type AdminChangeReason = "initial" | "succession";

/** Terminal outcome of a pending knock, delivered to the knocker. */
export type KnockResult = "approved" | "denied" | "timeout" | "canceled";

export interface RoomAdminState {
  /** The room's admin, or null when the room is empty. Always occupants[0]. */
  readonly admin: string | null;
  /** Admitted occupants, ordered by admission (tenure); admin is the head. */
  readonly occupants: readonly string[];
  /** Pending knockers awaiting an admin decision, ordered by knock time. */
  readonly knocks: readonly string[];
  /** Allow-all (open door) toggle: knocks auto-admit up to capacity. */
  readonly allowAll: boolean;
}

/** Per-room configuration the rules depend on (server capacity for the room). */
export interface RoomAdminConfig {
  readonly capacity: number;
}

export type RoomAdminEvent =
  | { type: "knock"; playerId: string }
  | { type: "approve"; by: string; playerId: string }
  | { type: "deny"; by: string; playerId: string }
  | { type: "cancel-knock"; playerId: string }
  | { type: "knock-timeout"; playerId: string }
  | { type: "leave"; playerId: string }
  | { type: "toggle-allow-all"; by: string; value: boolean };

export type RoomAdminEffect =
  /** Admit a player: write their room-access grant and let them in. */
  | { type: "admit"; playerId: string; asAdmin: boolean }
  /** Adminship changed (initial grant, succession, or null when room empties). */
  | { type: "admin-changed"; admin: string | null; reason: AdminChangeReason }
  /** The pending-knock list changed — re-broadcast it to the room's admin. */
  | { type: "knocks-changed"; knocks: readonly string[] }
  /** A knock registered — arm its ~30s timeout timer. */
  | { type: "knock-registered"; playerId: string }
  /** A knock ended without admission — disarm its timer, notify the knocker. */
  | { type: "knock-resolved"; playerId: string; result: KnockResult }
  /** Door visibility changed (allow-all flipped or capacity crossed). */
  | { type: "room-open-state"; allowAll: boolean; atCapacity: boolean }
  /** A player was blocked by capacity (tried to enter/approve into a full room). */
  | { type: "capacity-alert"; playerId: string };

export interface RoomAdminTransitionResult {
  state: RoomAdminState;
  effects: RoomAdminEffect[];
}

export const EMPTY_ROOM: RoomAdminState = { admin: null, occupants: [], knocks: [], allowAll: false };

/** Whether the room's occupancy is at (or over) its capacity. */
export function atCapacity(state: RoomAdminState, config: RoomAdminConfig): boolean {
  return state.occupants.length >= config.capacity;
}

/** The door-visibility-relevant projection: door is hidden iff open ∧ not full. */
function openState(state: RoomAdminState, config: RoomAdminConfig): { allowAll: boolean; atCapacity: boolean } {
  return { allowAll: state.allowAll, atCapacity: atCapacity(state, config) };
}

const stay = (state: RoomAdminState): RoomAdminTransitionResult => ({ state, effects: [] });

/**
 * Core reducer — every rule except the door-open-state diff, which is appended
 * uniformly by {@link roomAdminTransition} so no branch can forget it.
 */
function reduce(state: RoomAdminState, event: RoomAdminEvent, config: RoomAdminConfig): RoomAdminTransitionResult {
  const isOccupant = (id: string): boolean => state.occupants.includes(id);
  const isKnocking = (id: string): boolean => state.knocks.includes(id);
  const full = atCapacity(state, config);

  switch (event.type) {
    case "knock": {
      const p = event.playerId;
      if (isOccupant(p) || isKnocking(p)) return stay(state); // already inside / already knocking
      if (state.admin === null) {
        // Empty room: walk straight in as admin.
        return {
          state: { ...state, admin: p, occupants: [p] },
          effects: [
            { type: "admit", playerId: p, asAdmin: true },
            { type: "admin-changed", admin: p, reason: "initial" },
          ],
        };
      }
      if (full) {
        // Knock mode or allow-all, a full room turns everyone away.
        return { state, effects: [{ type: "capacity-alert", playerId: p }] };
      }
      if (state.allowAll) {
        // Open door: admit immediately, no admin action needed.
        return {
          state: { ...state, occupants: [...state.occupants, p] },
          effects: [{ type: "admit", playerId: p, asAdmin: false }],
        };
      }
      // Knock mode: register a pending request for the admin to decide.
      const knocks = [...state.knocks, p];
      return {
        state: { ...state, knocks },
        effects: [
          { type: "knocks-changed", knocks },
          { type: "knock-registered", playerId: p },
        ],
      };
    }

    case "approve": {
      if (event.by !== state.admin) return stay(state); // only the admin may approve
      if (!isKnocking(event.playerId)) return stay(state); // unknown / stale knocker
      if (full) {
        // Room filled since the knock; keep it pending, tell the admin why.
        return { state, effects: [{ type: "capacity-alert", playerId: event.by }] };
      }
      const knocks = state.knocks.filter((k) => k !== event.playerId);
      return {
        state: { ...state, knocks, occupants: [...state.occupants, event.playerId] },
        effects: [
          { type: "knocks-changed", knocks },
          { type: "admit", playerId: event.playerId, asAdmin: false },
        ],
      };
    }

    case "deny": {
      if (event.by !== state.admin) return stay(state);
      if (!isKnocking(event.playerId)) return stay(state);
      const knocks = state.knocks.filter((k) => k !== event.playerId);
      return {
        state: { ...state, knocks },
        effects: [
          { type: "knocks-changed", knocks },
          { type: "knock-resolved", playerId: event.playerId, result: "denied" },
        ],
      };
    }

    case "cancel-knock": {
      if (!isKnocking(event.playerId)) return stay(state);
      const knocks = state.knocks.filter((k) => k !== event.playerId);
      return {
        state: { ...state, knocks },
        effects: [
          { type: "knocks-changed", knocks },
          { type: "knock-resolved", playerId: event.playerId, result: "canceled" },
        ],
      };
    }

    case "knock-timeout": {
      if (!isKnocking(event.playerId)) return stay(state); // already resolved — timer race
      const knocks = state.knocks.filter((k) => k !== event.playerId);
      return {
        state: { ...state, knocks },
        effects: [
          { type: "knocks-changed", knocks },
          { type: "knock-resolved", playerId: event.playerId, result: "timeout" },
        ],
      };
    }

    case "leave": {
      const p = event.playerId;
      if (isKnocking(p)) {
        // A pending knocker walked away / disconnected: withdraw the knock.
        const knocks = state.knocks.filter((k) => k !== p);
        return {
          state: { ...state, knocks },
          effects: [
            { type: "knocks-changed", knocks },
            { type: "knock-resolved", playerId: p, result: "canceled" },
          ],
        };
      }
      if (!isOccupant(p)) return stay(state); // stray leave
      const occupants = state.occupants.filter((o) => o !== p);
      const wasAdmin = state.admin === p;
      const head = occupants[0];
      if (head === undefined) {
        // Last occupant left: reset to a fresh empty session, rejecting any
        // pending knocks (no admin remains to answer them).
        const effects: RoomAdminEffect[] = [];
        for (const k of state.knocks) effects.push({ type: "knock-resolved", playerId: k, result: "denied" });
        if (state.knocks.length > 0) effects.push({ type: "knocks-changed", knocks: [] });
        effects.push({ type: "admin-changed", admin: null, reason: "succession" });
        return { state: EMPTY_ROOM, effects };
      }
      // Occupants remain. Succession: the longest-tenured (new head) is admin.
      const effects: RoomAdminEffect[] = [];
      if (wasAdmin) effects.push({ type: "admin-changed", admin: head, reason: "succession" });
      return { state: { ...state, occupants, admin: head }, effects };
    }

    case "toggle-allow-all": {
      if (event.by !== state.admin) return stay(state); // only the admin may toggle
      if (event.value === state.allowAll) return stay(state); // idempotent
      if (!event.value) {
        return { state: { ...state, allowAll: false }, effects: [] };
      }
      // Turning allow-all ON resolves the pending queue: admit up to capacity in
      // tenure order, reject the overflow (they can just walk back to the now-open
      // door once a slot frees).
      const occupants = [...state.occupants];
      const effects: RoomAdminEffect[] = [];
      for (const k of state.knocks) {
        if (occupants.length < config.capacity) {
          occupants.push(k);
          effects.push({ type: "admit", playerId: k, asAdmin: false });
        } else {
          effects.push({ type: "knock-resolved", playerId: k, result: "denied" });
        }
      }
      if (state.knocks.length > 0) effects.push({ type: "knocks-changed", knocks: [] });
      return { state: { ...state, allowAll: true, occupants, knocks: [] }, effects };
    }
  }
}

/**
 * Apply one event to a room's access state. Total: every (state, event) pair is
 * defined, and illegal events (a non-admin approving/toggling, approving an
 * unknown knocker, knocking while inside) are inert no-ops. Appends a single
 * `room-open-state` effect whenever the door's visibility projection changed, so
 * the manager never has to recompute it.
 */
export function roomAdminTransition(
  state: RoomAdminState,
  event: RoomAdminEvent,
  config: RoomAdminConfig,
): RoomAdminTransitionResult {
  const result = reduce(state, event, config);
  const before = openState(state, config);
  const after = openState(result.state, config);
  if (before.allowAll !== after.allowAll || before.atCapacity !== after.atCapacity) {
    result.effects.push({ type: "room-open-state", allowAll: after.allowAll, atCapacity: after.atCapacity });
  }
  return result;
}
