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
  arcadeVolume: number; // 0..1, arcade mini-game sfx channel (own control)
  muted: boolean; // master mute — silences everything, volumes preserved
  muteSfx: boolean; // silence gameplay sfx specifically (kept for back-compat)
  muteArcade: boolean; // silence arcade mini-game sounds specifically
  notifySound: boolean; // play a chime on incoming chat
  tabFlash: boolean; // flash the tab title / Web Notification when unfocused
}

const KEY = "mv:settings";

const DEFAULTS: Settings = {
  masterVolume: 0.6,
  // PRD 21: lowered from 0.4 — the curated calm pool is meant to sit under
  // conversation by default, not be the first thing a new player reaches to
  // mute. Existing players' saved slider values are untouched (see `load`).
  musicVolume: 0.2,
  sfxVolume: 0.7,
  ambientVolume: 0.5,
  arcadeVolume: 0.8,
  muted: false,
  muteSfx: false,
  muteArcade: false,
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
