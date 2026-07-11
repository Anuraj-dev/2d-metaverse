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
});
