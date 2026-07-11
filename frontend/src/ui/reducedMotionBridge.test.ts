import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A controllable prefers-reduced-motion matchMedia mock.
let systemMatches = false;
const changeHandlers = new Set<() => void>();

function installMatchMedia() {
  systemMatches = false;
  changeHandlers.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? systemMatches : false,
    media: query,
    addEventListener: (_: string, cb: () => void) => changeHandlers.add(cb),
    removeEventListener: (_: string, cb: () => void) => changeHandlers.delete(cb),
    addListener: (cb: () => void) => changeHandlers.add(cb),
    removeListener: (cb: () => void) => changeHandlers.delete(cb),
    onchange: null,
    dispatchEvent: () => false,
  }));
}

function fireSystemChange(next: boolean) {
  systemMatches = next;
  changeHandlers.forEach((cb) => cb());
}

describe("reducedMotionBridge", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.documentElement.removeAttribute("data-reduced-motion");
    installMatchMedia();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stamps the root attribute from the OS query under the default 'system' setting", async () => {
    systemMatches = true;
    const { initReducedMotion, isReducedMotion } = await import("./reducedMotionBridge");
    initReducedMotion();
    expect(isReducedMotion()).toBe(true);
    expect(document.documentElement.getAttribute("data-reduced-motion")).toBe("true");
  });

  it("lets the explicit 'off' setting win over an OS reduce preference", async () => {
    systemMatches = true;
    const { initReducedMotion, isReducedMotion } = await import("./reducedMotionBridge");
    const { setSettings } = await import("./settings");
    initReducedMotion();
    setSettings({ reducedMotion: "off" });
    expect(isReducedMotion()).toBe(false);
    expect(document.documentElement.getAttribute("data-reduced-motion")).toBe("false");
  });

  it("lets the explicit 'on' setting win over no OS preference", async () => {
    const { initReducedMotion, isReducedMotion } = await import("./reducedMotionBridge");
    const { setSettings } = await import("./settings");
    initReducedMotion();
    setSettings({ reducedMotion: "on" });
    expect(isReducedMotion()).toBe(true);
    expect(document.documentElement.getAttribute("data-reduced-motion")).toBe("true");
  });

  it("reacts to an OS query change while following 'system'", async () => {
    const { initReducedMotion, isReducedMotion, subscribeReducedMotion } = await import(
      "./reducedMotionBridge"
    );
    initReducedMotion();
    const seen: boolean[] = [];
    subscribeReducedMotion((r) => seen.push(r));
    expect(isReducedMotion()).toBe(false);
    fireSystemChange(true);
    expect(isReducedMotion()).toBe(true);
    expect(seen).toContain(true);
    expect(document.documentElement.getAttribute("data-reduced-motion")).toBe("true");
  });
});
