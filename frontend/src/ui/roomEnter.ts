/** Maps a `room-enter-result` failure reason to a user-facing message. */
export function roomEnterErrorMessage(reason?: string): string {
  switch (reason) {
    case "full":
      return "Room is full.";
    case "rate-limited":
      return "Too many attempts — please wait a moment and try again.";
    default:
      return "Wrong key, try again.";
  }
}
