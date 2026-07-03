import { describe, it, expect } from "vitest";
import {
  channelGain,
  clamp01,
  volumesFromSettings,
  anyVoiceActive,
  cueForEvent,
  EVENT_SOUNDS,
  footstepDue,
  DUCK_FACTOR,
  VOICE_THRESHOLD,
  type MixerVolumes,
} from "./soundMixer";
import { getSettings } from "../ui/settings";

const base: MixerVolumes = {
  master: 1,
  music: 1,
  sfx: 1,
  ambient: 1,
  muted: false,
  muteSfx: false,
};

describe("clamp01", () => {
  it.each([
    [-1, 0],
    [0, 0],
    [0.5, 0.5],
    [1, 1],
    [2, 1],
    [NaN, 0],
  ])("clamps %p to %p", (input, out) => {
    expect(clamp01(input)).toBe(out);
  });
});

describe("channelGain", () => {
  it("scales each channel by the master", () => {
    const v = { ...base, master: 0.5, music: 0.5, sfx: 0.8, ambient: 0.4 };
    expect(channelGain(v, "music")).toBeCloseTo(0.25);
    expect(channelGain(v, "sfx")).toBeCloseTo(0.4);
    expect(channelGain(v, "ambient")).toBeCloseTo(0.2);
  });

  it("master mute forces every channel to 0 without losing the stored volumes", () => {
    const v = { ...base, muted: true };
    expect(channelGain(v, "music")).toBe(0);
    expect(channelGain(v, "sfx")).toBe(0);
    expect(channelGain(v, "ambient")).toBe(0);
  });

  it("master at 0 forces silence", () => {
    expect(channelGain({ ...base, master: 0 }, "sfx")).toBe(0);
  });

  it("muteSfx silences only the sfx channel", () => {
    const v = { ...base, muteSfx: true };
    expect(channelGain(v, "sfx")).toBe(0);
    expect(channelGain(v, "music")).toBe(1);
    expect(channelGain(v, "ambient")).toBe(1);
  });

  it("ducks the ambient channel while voice is active, but not music/sfx", () => {
    expect(channelGain(base, "ambient", { voiceActive: true })).toBeCloseTo(DUCK_FACTOR);
    expect(channelGain(base, "music", { voiceActive: true })).toBe(1);
    expect(channelGain(base, "sfx", { voiceActive: true })).toBe(1);
  });

  it("does not duck ambient when voice is inactive", () => {
    expect(channelGain(base, "ambient", { voiceActive: false })).toBe(1);
  });

  it("clamps out-of-range channel volumes", () => {
    expect(channelGain({ ...base, sfx: 5 }, "sfx")).toBe(1);
    expect(channelGain({ ...base, master: 5, music: 5 }, "music")).toBe(1);
  });
});

describe("volumesFromSettings (persistence round-trip)", () => {
  it("mirrors the persisted default settings shape", () => {
    const v = volumesFromSettings(getSettings());
    // defaults: master .6, music .4, sfx .7, ambient .5
    expect(channelGain(v, "music")).toBeCloseTo(0.6 * 0.4);
    expect(channelGain(v, "sfx")).toBeCloseTo(0.6 * 0.7);
    expect(channelGain(v, "ambient")).toBeCloseTo(0.6 * 0.5);
  });
});

describe("anyVoiceActive", () => {
  it("is false for an empty map", () => {
    expect(anyVoiceActive({})).toBe(false);
  });
  it("is false when all speakers are below threshold", () => {
    expect(anyVoiceActive({ a: 0.01, b: 0.0 })).toBe(false);
  });
  it("is true when any speaker is at or above threshold", () => {
    expect(anyVoiceActive({ a: 0.01, b: VOICE_THRESHOLD })).toBe(true);
  });
});

describe("cueForEvent", () => {
  it("maps known events to a clip + channel", () => {
    expect(cueForEvent("door-open")).toEqual({ clip: "door_open", channel: "sfx" });
    expect(cueForEvent("portal-enter")).toEqual({ clip: "portal_in", channel: "sfx" });
    expect(cueForEvent("meeting-grid-visible")).toEqual({
      clip: "meeting_join",
      channel: "sfx",
    });
  });
  it("returns null for unmapped events", () => {
    expect(cueForEvent("leave-door")).toBeNull();
    expect(cueForEvent("positions")).toBeNull();
  });
  it("every mapped cue names a real channel", () => {
    for (const cue of Object.values(EVENT_SOUNDS)) {
      expect(["music", "sfx", "ambient"]).toContain(cue.channel);
    }
  });
});

describe("footstepDue", () => {
  it("never fires while stationary", () => {
    const r = footstepDue({ lastStepAt: 0 }, 10_000, false);
    expect(r.play).toBe(false);
    expect(r.state.lastStepAt).toBe(0);
  });
  it("fires immediately on first move (interval elapsed since 0)", () => {
    const r = footstepDue({ lastStepAt: 0 }, 1000, true);
    expect(r.play).toBe(true);
    expect(r.state.lastStepAt).toBe(1000);
  });
  it("throttles to the stride interval while moving", () => {
    const a = footstepDue({ lastStepAt: 1000 }, 1100, true, 300);
    expect(a.play).toBe(false);
    const b = footstepDue({ lastStepAt: 1000 }, 1300, true, 300);
    expect(b.play).toBe(true);
    expect(b.state.lastStepAt).toBe(1300);
  });
});
