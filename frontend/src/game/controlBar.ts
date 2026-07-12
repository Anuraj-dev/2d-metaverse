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

/**
 * Bounded feedback when a device toggle could not be honoured (PRD 25.7): the
 * control bar awaits the publish outcome and announces this instead of the
 * optimistic on/off toast when a `denied`/`unavailable`/`failed` came back. Pure
 * copy — the same aria-live region reads it.
 */
export function mediaFailureText(
  device: "mic" | "cam",
  failure: "denied" | "unavailable" | "failed",
): string {
  const noun = device === "mic" ? "Microphone" : "Camera";
  switch (failure) {
    case "denied":
      return `${noun} blocked — allow access in your browser`;
    case "unavailable":
      return device === "mic" ? "No microphone found" : "No camera found";
    case "failed":
      return `Couldn't turn on the ${device === "mic" ? "microphone" : "camera"}`;
  }
}
