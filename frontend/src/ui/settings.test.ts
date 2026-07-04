import { describe, it, expect, beforeEach } from "vitest";
import { getSettings, setSettings, subscribeSettings } from "./settings";

describe("settings store", () => {
  beforeEach(() => localStorage.clear());

  it("exposes sane defaults", () => {
    const s = getSettings();
    expect(s.masterVolume).toBeGreaterThan(0);
    expect(typeof s.muteSfx).toBe("boolean");
    expect(typeof s.notifySound).toBe("boolean");
  });

  it("exposes per-channel volume + master mute defaults", () => {
    const s = getSettings();
    for (const v of [s.musicVolume, s.sfxVolume, s.ambientVolume]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(typeof s.muted).toBe("boolean");
    expect(s.muted).toBe(false);
  });

  it("persists per-channel volumes and master mute round-trip", () => {
    setSettings({ musicVolume: 0.1, sfxVolume: 0.9, ambientVolume: 0.2, muted: true });
    const s = getSettings();
    expect(s.musicVolume).toBe(0.1);
    expect(s.sfxVolume).toBe(0.9);
    expect(s.ambientVolume).toBe(0.2);
    expect(s.muted).toBe(true);
    const stored = localStorage.getItem("mv:settings");
    if (stored === null) throw new Error("settings were not persisted to localStorage");
    const raw = JSON.parse(stored) as { sfxVolume: number; muted: boolean };
    expect(raw.sfxVolume).toBe(0.9);
    expect(raw.muted).toBe(true);
  });

  it("exposes an arcade volume + mute with sane defaults, round-tripped", () => {
    const d = getSettings();
    expect(d.arcadeVolume).toBeGreaterThanOrEqual(0);
    expect(d.arcadeVolume).toBeLessThanOrEqual(1);
    expect(d.muteArcade).toBe(false);
    setSettings({ arcadeVolume: 0.33, muteArcade: true });
    const s = getSettings();
    expect(s.arcadeVolume).toBe(0.33);
    expect(s.muteArcade).toBe(true);
  });

  it("merges patches and persists to localStorage", () => {
    setSettings({ masterVolume: 0.25, muteSfx: true });
    const s = getSettings();
    expect(s.masterVolume).toBe(0.25);
    expect(s.muteSfx).toBe(true);
    const stored = localStorage.getItem("mv:settings");
    if (stored === null) throw new Error("settings were not persisted to localStorage");
    const raw = JSON.parse(stored) as { masterVolume: number };
    expect(raw.masterVolume).toBe(0.25);
  });

  it("notifies subscribers until unsubscribed", () => {
    let calls = 0;
    const off = subscribeSettings(() => calls++);
    setSettings({ notifySound: false });
    expect(calls).toBe(1);
    off();
    setSettings({ notifySound: true });
    expect(calls).toBe(1);
  });
});
