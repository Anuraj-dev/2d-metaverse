/**
 * Tiny localStorage-backed settings store, shared across the HUD and media layer.
 * Synchronous get/set + subscribe so React panels and the sfx/notification code
 * read one source of truth. No backend.
 */
export interface Settings {
  masterVolume: number; // 0..1, master gain over every channel
  musicVolume: number; // 0..1, background music bed channel
  sfxVolume: number; // 0..1, event/gameplay sfx channel
  ambientVolume: number; // 0..1, outdoor ambient bed channel
  muted: boolean; // master mute — silences everything, volumes preserved
  muteSfx: boolean; // silence gameplay sfx specifically (kept for back-compat)
  notifySound: boolean; // play a chime on incoming chat
  tabFlash: boolean; // flash the tab title / Web Notification when unfocused
}

const KEY = "mv:settings";

const DEFAULTS: Settings = {
  masterVolume: 0.6,
  musicVolume: 0.4,
  sfxVolume: 0.7,
  ambientVolume: 0.5,
  muted: false,
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
