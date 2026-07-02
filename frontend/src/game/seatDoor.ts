/**
 * Seat + door state machines: pure transitions with explicit side-effect intents.
 *
 * Extracted from WorldScene so the sit/stand and open/close edge cases (including
 * illegal transitions such as standing while already standing, or sitting with no
 * seat under you) are enumerable as tests. The scene owns the actual Phaser/net
 * effects — these functions only decide the next state and which effect, if any,
 * should fire.
 */

/* ------------------------------- Seat ------------------------------- */
export type SeatEffect = "sit" | "stand" | null;

export interface SeatResult {
  seated: boolean;
  effect: SeatEffect;
}

/**
 * Resolve a sit/stand action.
 *  - sit succeeds only from standing with a seat available → effect "sit"
 *  - stand succeeds only from seated → effect "stand"
 *  - every other combination is a no-op (state unchanged, effect null)
 */
export function seatTransition(
  seated: boolean,
  action: "sit" | "stand",
  hasSeat: boolean
): SeatResult {
  if (action === "sit") {
    if (!seated && hasSeat) return { seated: true, effect: "sit" };
    return { seated, effect: null };
  }
  // stand
  if (seated) return { seated: false, effect: "stand" };
  return { seated: false, effect: null };
}

/* ------------------------------- Door ------------------------------- */
export type DoorState = "closed" | "open";
export type DoorEffect = "open" | "close" | null;

export interface DoorResult {
  state: DoorState;
  effect: DoorEffect;
}

/**
 * Resolve a door enter/exit action.
 *  - entering a closed door opens it → effect "open"
 *  - exiting through an open door closes it → effect "close"
 *  - repeating an action already in effect is an idempotent no-op
 */
export function doorTransition(
  state: DoorState,
  action: "enter" | "exit"
): DoorResult {
  if (action === "enter") {
    if (state === "closed") return { state: "open", effect: "open" };
    return { state: "open", effect: null };
  }
  // exit
  if (state === "open") return { state: "closed", effect: "close" };
  return { state: "closed", effect: null };
}
