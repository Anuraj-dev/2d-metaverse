import { beforeEach, describe, expect, it, vi } from "vitest";

describe("browser-session media preferences", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules();
  });

  it("starts a new browser session with microphone and camera off", async () => {
    const { getMediaPrefs } = await import("./mediaPrefs");

    expect(getMediaPrefs()).toEqual({ micOn: false, camOn: false });
  });

  it("retains an explicit choice across reloads in the same tab session", async () => {
    const firstLoad = await import("./mediaPrefs");
    firstLoad.setMediaPrefs({ micOn: true, camOn: true });

    vi.resetModules();
    const reloaded = await import("./mediaPrefs");

    expect(reloaded.getMediaPrefs()).toEqual({ micOn: true, camOn: true });
  });

  it("falls back to off when stored session data is malformed", async () => {
    sessionStorage.setItem("mv:media-prefs", JSON.stringify({ micOn: true, camOn: "yes" }));

    const { getMediaPrefs } = await import("./mediaPrefs");

    expect(getMediaPrefs()).toEqual({ micOn: false, camOn: false });
  });
  it("does not retain stage-only microphone consent across reloads or camera changes", async () => {
    const firstLoad = await import("./mediaPrefs");
    firstLoad.beginStageMicOverride();
    expect(firstLoad.getMediaPrefs().micOn).toBe(true);
    firstLoad.setMediaPrefs({ camOn: true });

    vi.resetModules();
    const reloaded = await import("./mediaPrefs");
    expect(reloaded.getMediaPrefs()).toEqual({ micOn: false, camOn: true });
  });

  it("restores microphone silence when temporary stage consent ends", async () => {
    const prefs = await import("./mediaPrefs");
    prefs.beginStageMicOverride();
    prefs.endStageMicOverride();
    expect(prefs.getMediaPrefs().micOn).toBe(false);
  });

  it.each([true, false])("preserves an explicit mic choice of %s made during a broadcast", async (micOn) => {
    const prefs = await import("./mediaPrefs");
    prefs.beginStageMicOverride();
    prefs.setMediaPrefs({ micOn });
    prefs.endStageMicOverride();
    expect(prefs.getMediaPrefs().micOn).toBe(micOn);

    vi.resetModules();
    const reloaded = await import("./mediaPrefs");
    expect(reloaded.getMediaPrefs().micOn).toBe(micOn);
  });

  it("retains pre-existing microphone consent after a broadcast", async () => {
    const prefs = await import("./mediaPrefs");
    prefs.setMediaPrefs({ micOn: true });
    prefs.beginStageMicOverride();
    prefs.endStageMicOverride();
    expect(prefs.getMediaPrefs().micOn).toBe(true);
  });

});
