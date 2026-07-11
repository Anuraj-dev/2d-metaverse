/**
 * Leaf module: the player's desired local mic/cam publish state — the single source
 * of truth for the global control bar (PRD 20). It imports nothing app-specific, so
 * both the LiveKit transport (which re-applies these whenever a room becomes active,
 * keeping one mute sticky across walk<->meeting transitions) and the bar can read it
 * without an import cycle. Explicit choices persist only in sessionStorage: reloads
 * in this tab retain consent, while an empty/new page session starts safely off.
 * The side-effecting fan-out to live rooms lives in `media/mediaControls.ts`.
 */
export interface MediaPrefs {
  readonly micOn: boolean;
  readonly camOn: boolean;
}

const SESSION_KEY = "mv:media-prefs";
const CONSENT_SAFE_DEFAULTS: MediaPrefs = { micOn: false, camOn: false };

function readSessionPrefs(): MediaPrefs {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw === null) return CONSENT_SAFE_DEFAULTS;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      "micOn" in value &&
      typeof value.micOn === "boolean" &&
      "camOn" in value &&
      typeof value.camOn === "boolean"
    ) {
      return { micOn: value.micOn, camOn: value.camOn };
    }
  } catch {
    // Storage may be blocked or malformed; privacy-safe defaults still apply.
  }
  return CONSENT_SAFE_DEFAULTS;
}

let prefs: MediaPrefs = readSessionPrefs();
const listeners = new Set<() => void>();

export function getMediaPrefs(): MediaPrefs {
  return prefs;
}

/** Merge a patch; notifies subscribers only when a value actually changed. */
export function setMediaPrefs(patch: Partial<MediaPrefs>): void {
  const next: MediaPrefs = { ...prefs, ...patch };
  if (next.micOn === prefs.micOn && next.camOn === prefs.camOn) return;
  prefs = next;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(prefs));
  } catch {
    // Keep the in-memory preference when session storage is unavailable.
  }
  listeners.forEach((l) => l());
}

export function subscribeMediaPrefs(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
