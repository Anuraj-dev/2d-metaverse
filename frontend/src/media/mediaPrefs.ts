/**
 * Leaf module: the player's desired local mic/cam publish state — the single source
 * of truth for the global control bar (PRD 20). It imports nothing app-specific, so
 * both the LiveKit transport (which re-applies these whenever a room becomes active,
 * keeping one mute sticky across walk<->meeting transitions) and the bar can read it
 * without an import cycle. State only; the side-effecting fan-out to the live rooms
 * lives in `media/mediaControls.ts`.
 */
export interface MediaPrefs {
  readonly micOn: boolean;
  readonly camOn: boolean;
}

let prefs: MediaPrefs = { micOn: true, camOn: true };
const listeners = new Set<() => void>();

export function getMediaPrefs(): MediaPrefs {
  return prefs;
}

/** Merge a patch; notifies subscribers only when a value actually changed. */
export function setMediaPrefs(patch: Partial<MediaPrefs>): void {
  const next: MediaPrefs = { ...prefs, ...patch };
  if (next.micOn === prefs.micOn && next.camOn === prefs.camOn) return;
  prefs = next;
  listeners.forEach((l) => l());
}

export function subscribeMediaPrefs(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
