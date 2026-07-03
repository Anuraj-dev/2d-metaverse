/**
 * Pure Phase A / Phase B portal-handoff state machine.
 *
 * Phase A is the Phaser side of the portal (camera punch-in + fade + frame
 * snapshot + scene sleep); Phase B is the React side (the warp-burst overlay
 * mounting). The meeting grid must be revealed exactly once, only when BOTH
 * have signalled — aligning A's final frame with B's mount so there is no gap
 * and no double-flash, whichever side finishes first.
 *
 * Pure module per the scene-as-glue convention: no Phaser, DOM, or net imports.
 */

export interface HandoffState {
  phase: "idle" | "waiting" | "revealed";
  aDone: boolean;
  bReady: boolean;
}

export type HandoffEvent = "a-done" | "b-ready";

export const HANDOFF_IDLE: HandoffState = { phase: "idle", aDone: false, bReady: false };

/** Arm the machine when a portal-in begins. */
export function handoffStart(): HandoffState {
  return { phase: "waiting", aDone: false, bReady: false };
}

/**
 * Feed one side's completion. `reveal` is true exactly once — on the event
 * that completes the pair.
 */
export function handoffEvent(
  state: HandoffState,
  event: HandoffEvent,
): { state: HandoffState; reveal: boolean } {
  if (state.phase !== "waiting") return { state, reveal: false };
  const next: HandoffState = {
    ...state,
    aDone: state.aDone || event === "a-done",
    bReady: state.bReady || event === "b-ready",
  };
  if (next.aDone && next.bReady) {
    return { state: { ...next, phase: "revealed" }, reveal: true };
  }
  return { state: next, reveal: false };
}
