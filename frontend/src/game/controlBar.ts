/**
 * Pure copy + feedback mapping for the global control bar's toggles (PRD 20). Plain
 * values in / out — no React, DOM, or media imports. The bar component renders the
 * icon and announces this text through an aria-live region; keeping the wording here
 * makes it deterministically testable and keeps the component a thin surface.
 */
export function micToastText(on: boolean): string {
  return on ? "Microphone on" : "Microphone muted";
}

export function camToastText(on: boolean): string {
  return on ? "Camera on" : "Camera off";
}
