import { beforeEach, describe, expect, it, vi } from "vitest";
import { localModeration } from "./localModeration";

/**
 * The session moderation store (PRD 25.13). Decisions themselves are proven in
 * game/muteBlock.test.ts; this covers the store's session state + subscription and
 * the mute-vs-block distinction (mute keeps video, block hides it).
 */
beforeEach(() => {
  // Reset to a clean session between tests (singleton, so state leaks otherwise).
  localModeration.setBlocked([]);
  for (const id of localModeration.mutedIds()) localModeration.toggleMute(id);
});

describe("localModeration store", () => {
  it("toggles a session mute on and off and reports it", () => {
    expect(localModeration.isMuted("a")).toBe(false);
    expect(localModeration.toggleMute("a")).toBe(true);
    expect(localModeration.isMuted("a")).toBe(true);
    expect(localModeration.mutedIds()).toEqual(["a"]);
    expect(localModeration.toggleMute("a")).toBe(false);
    expect(localModeration.isMuted("a")).toBe(false);
  });

  it("mirrors a server block list and mutes it for audio/video/speaking", () => {
    localModeration.setBlocked(["b"]);
    expect(localModeration.isBlocked("b")).toBe(true);
    expect(localModeration.audioMutedIds().has("b")).toBe(true);
    expect(localModeration.isVideoHidden("b")).toBe(true);
    expect(localModeration.filterSpeaking(["b", "c"])).toEqual(["c"]);
  });

  it("distinguishes mute (keeps video) from block (hides video)", () => {
    localModeration.toggleMute("a");
    // A muted peer: audio + speaking suppressed, but video is NOT hidden.
    expect(localModeration.audioMutedIds().has("a")).toBe(true);
    expect(localModeration.filterSpeaking(["a"])).toEqual([]);
    expect(localModeration.isVideoHidden("a")).toBe(false);
  });

  it("addBlocked/removeBlocked update only future suppression", () => {
    localModeration.addBlocked("x");
    expect(localModeration.blockedIds()).toEqual(["x"]);
    localModeration.removeBlocked("x");
    expect(localModeration.blockedIds()).toEqual([]);
    expect(localModeration.isCommsSuppressed("x")).toBe(false);
  });

  it("notifies subscribers on change and fires once immediately", () => {
    const cb = vi.fn();
    const off = localModeration.subscribe(cb);
    expect(cb).toHaveBeenCalledTimes(1); // immediate
    localModeration.toggleMute("a");
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    localModeration.toggleMute("a");
    expect(cb).toHaveBeenCalledTimes(2); // no more after unsubscribe
  });
});
