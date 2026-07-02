/**
 * E2E test hook — exposes the event bus and minimal game state on
 * `window.__testHook` so the Playwright suite can make bus-seam assertions
 * instead of reading pixels off the Phaser canvas.
 *
 * This module is only reachable behind the build-time `VITE_E2E_HOOK=1` flag
 * (see main.tsx); production builds tree-shake the import entirely, and CI
 * verifies the prod bundle contains no trace of it.
 */
import { bus } from "../game/eventBus";

// Injected by vite `define` (declared here as well as in vite-env.d.ts so the
// type-only import of TestHook from the e2e project resolves standalone).
declare const __APP_SHA__: string;

/** Game -> UI events the hook mirrors into `state.last` / the event log. */
const TRACKED_EVENTS = [
  "near-door",
  "leave-door",
  "near-seat",
  "leave-seat",
  "sat",
  "stood",
  "positions",
  "room-entered",
  "room-left",
  "world-info",
  "near-interactable",
  "leave-interactable",
  "open-interactable",
  "near-stage",
  "leave-stage",
  "audio-volumes",
] as const;

/** High-frequency events kept out of the bounded event log (state-only). */
const LOG_EXCLUDED = new Set<string>(["positions", "audio-volumes"]);
const EVENT_LOG_CAP = 1000;

interface LoggedEvent {
  event: string;
  payload: unknown;
  at: number;
}

interface HookState {
  /** Latest payload per tracked event (undefined until first emission). */
  last: Record<string, unknown>;
  /** Bounded log of tracked events, oldest first (positions excluded). */
  events: LoggedEvent[];
  /** Door currently in range, from near-door / leave-door. */
  nearDoor: { roomId: string; name: string } | null;
  /** Seat currently in range, from near-seat / leave-seat. */
  nearSeat: { roomId: string; seatId: number | string } | null;
  /** Room the player is inside, from room-entered / room-left. */
  currentRoomId: string | null;
  /** Own seat, from sat / stood. */
  seated: { roomId: string; seatId: number | string } | null;
}

export interface TestHook {
  sha: string;
  state: HookState;
  emit: (event: string, payload?: unknown) => void;
  on: (event: string, cb: (payload: unknown) => void) => () => void;
  /**
   * Resolves with the payload of the next `event` matching `predicate`
   * (if given). Rejects after `timeoutMs`. Purely event-driven — no polling.
   */
  waitForEvent: (
    event: string,
    predicate?: (payload: unknown) => boolean,
    timeoutMs?: number,
  ) => Promise<unknown>;
}

declare global {
  interface Window {
    __testHook?: TestHook;
  }
}

export function installTestHook(): void {
  const state: HookState = {
    last: {},
    events: [],
    nearDoor: null,
    nearSeat: null,
    currentRoomId: null,
    seated: null,
  };

  for (const event of TRACKED_EVENTS) {
    bus.on(event, (payload: unknown) => {
      state.last[event] = payload;
      if (!LOG_EXCLUDED.has(event)) {
        state.events.push({ event, payload, at: Date.now() });
        if (state.events.length > EVENT_LOG_CAP) state.events.shift();
      }
      switch (event) {
        case "near-door":
          state.nearDoor = payload as HookState["nearDoor"];
          break;
        case "leave-door":
          state.nearDoor = null;
          break;
        case "near-seat":
          state.nearSeat = payload as HookState["nearSeat"];
          break;
        case "leave-seat":
          state.nearSeat = null;
          break;
        case "room-entered":
          state.currentRoomId = (payload as { roomId: string }).roomId;
          break;
        case "room-left":
          state.currentRoomId = null;
          break;
        case "sat":
          state.seated = payload as HookState["seated"];
          break;
        case "stood":
          state.seated = null;
          break;
      }
    });
  }

  window.__testHook = {
    sha: __APP_SHA__,
    state,
    emit: (event, payload) => bus.emit(event, payload),
    on: (event, cb) => bus.on(event, cb),
    waitForEvent: (event, predicate, timeoutMs = 15_000) =>
      new Promise((resolve, reject) => {
        const off = bus.on(event, (payload: unknown) => {
          if (predicate && !predicate(payload)) return;
          clearTimeout(timer);
          off();
          resolve(payload);
        });
        const timer = setTimeout(() => {
          off();
          reject(new Error(`testHook: timed out waiting for '${event}' after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
  };
}
