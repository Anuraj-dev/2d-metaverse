/**
 * Bounded feedback when a device toggle could not be honoured (PRD 25.7): the
 * control bar announces this only when a `denied`/`unavailable`/`failed` outcome
 * comes back. Successful toggles need no duplicate status message because the
 * button icon and pressed state already make the result visible.
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
