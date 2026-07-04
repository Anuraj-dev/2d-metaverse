/**
 * Pure stage on-air state machine (PRD 17). Decides, from position + time alone,
 * when a performer standing on the stage zone is offered the "go on air" confirm
 * prompt, and when they actually go on / off air. No Phaser / net / DOM imports —
 * `WorldScene` drives it each frame (a `tick` carrying the local player's stage
 * membership + floored position + clock) and forwards the `confirm`/`decline` the
 * HUD prompt produces; `App` reacts to the emitted effects (media publish, ON-AIR
 * indicator, on/off-air sounds).
 *
 * Rules (mirrors the PRD's transition table):
 *  - crossing the stage (never still) never prompts;
 *  - standing still on stage for `STILL_MS` arms the confirm prompt;
 *  - declining stays on stage un-broadcast and does NOT re-prompt until the player
 *    MOVES again, or LEAVES the zone and returns;
 *  - confirming goes on air;
 *  - leaving the stage zone goes off air (or dismisses the prompt) instantly;
 *  - movement while on air never ends the broadcast — only leaving the zone does.
 */
export const STILL_MS = 2000;

export type OnAirPhase = "idle" | "arming" | "prompt" | "declined" | "onair";

export interface OnAirState {
  phase: OnAirPhase;
  /** Last observed floored position — a change resets the stillness clock. */
  x: number;
  y: number;
  /** Timestamp the current uninterrupted still period began. */
  stillSince: number;
}

export type OnAirInput =
  | { type: "tick"; onStage: boolean; x: number; y: number; now: number }
  | { type: "confirm" }
  | { type: "decline" };

export type OnAirEffect =
  | "none"
  | "show-prompt"
  | "hide-prompt"
  | "go-on-air"
  | "go-off-air";

export function initOnAir(): OnAirState {
  // NaN position guarantees the first tick reads as "moved" (never instantly
  // still), so a player teleported onto the stage still has to hold position.
  return { phase: "idle", x: NaN, y: NaN, stillSince: 0 };
}

export function stepOnAir(
  state: OnAirState,
  input: OnAirInput,
  stillMs: number = STILL_MS,
): { state: OnAirState; effect: OnAirEffect } {
  if (input.type === "confirm") {
    if (state.phase === "prompt") {
      return { state: { ...state, phase: "onair" }, effect: "go-on-air" };
    }
    return { state, effect: "none" };
  }
  if (input.type === "decline") {
    if (state.phase === "prompt") {
      return { state: { ...state, phase: "declined" }, effect: "hide-prompt" };
    }
    return { state, effect: "none" };
  }

  const { onStage, x, y, now } = input;

  // Off the stage zone: instant off-air / prompt dismissal, back to idle.
  if (!onStage) {
    const effect: OnAirEffect =
      state.phase === "onair" ? "go-off-air" : state.phase === "prompt" ? "hide-prompt" : "none";
    return { state: { phase: "idle", x, y, stillSince: now }, effect };
  }

  // On stage & already broadcasting: movement is fine, only leaving ends it.
  if (state.phase === "onair") {
    return { state: { ...state, x, y }, effect: "none" };
  }

  const moved = x !== state.x || y !== state.y;
  if (moved) {
    // Any movement (re)starts the stillness clock, dismisses a live prompt, and
    // re-arms after a decline — the one path back to a prompt without leaving.
    const effect: OnAirEffect = state.phase === "prompt" ? "hide-prompt" : "none";
    return { state: { phase: "arming", x, y, stillSince: now }, effect };
  }

  // Stationary on stage.
  if (state.phase === "idle") {
    return { state: { phase: "arming", x, y, stillSince: now }, effect: "none" };
  }
  if (state.phase === "arming" && now - state.stillSince >= stillMs) {
    return { state: { ...state, x, y, phase: "prompt" }, effect: "show-prompt" };
  }
  // arming (not yet elapsed), prompt (already shown), or declined (latched).
  return { state: { ...state, x, y }, effect: "none" };
}
