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
