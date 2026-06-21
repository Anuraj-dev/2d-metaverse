/**
 * Tiny localStorage-backed settings store, shared across the HUD and media layer.
 * Synchronous get/set + subscribe so React panels and the sfx/notification code
 * read one source of truth. No backend.
 */
export interface Settings {
  masterVolume: number; // 0..1, applies to all sfx
  muteSfx: boolean; // silence gameplay sfx (join/leave/sit/ambient)
  notifySound: boolean; // play a chime on incoming chat
  tabFlash: boolean; // flash the tab title / Web Notification when unfocused
}

const KEY = "mv:settings";

const DEFAULTS: Settings = {
  masterVolume: 0.6,
  muteSfx: false,
  notifySound: true,
  tabFlash: true,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = load();
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

export function setSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore quota/private-mode errors */
  }
  listeners.forEach((cb) => cb(current));
}

export function subscribeSettings(cb: (s: Settings) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
