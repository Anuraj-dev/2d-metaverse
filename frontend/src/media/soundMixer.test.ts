import { describe, it, expect } from "vitest";
import {
  channelGain,
  clamp01,
  volumesFromSettings,
  anyVoiceActive,
  cueForEvent,
  EVENT_SOUNDS,
  footstepDue,
  fadeStep,
  loopTargets,
  DUCK_FACTOR,
  LOOP_FADE_MS,
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

describe("loopTargets (loop lifecycle: outdoors / meeting)", () => {
  const vols = { ...base, music: 0.8, ambient: 0.6 };
  const world = { outdoors: true, meeting: false, voiceActive: false };

  it("outdoors, no meeting: both loops at their channel gains", () => {
    expect(loopTargets(vols, world)).toEqual({ music: 0.8, ambient: 0.6 });
  });

  it("indoors silences the ambient bed but not the music", () => {
    expect(loopTargets(vols, { ...world, outdoors: false })).toEqual({
      music: 0.8,
      ambient: 0,
    });
  });

  it("a meeting silences both world loops", () => {
    expect(loopTargets(vols, { ...world, meeting: true })).toEqual({
      music: 0,
      ambient: 0,
    });
  });

  it("meeting wins even while outdoors with active voice", () => {
    expect(
      loopTargets(vols, { outdoors: true, meeting: true, voiceActive: true })
    ).toEqual({ music: 0, ambient: 0 });
  });

  it("outdoors with voice ducks the ambient bed by DUCK_FACTOR", () => {
    const t = loopTargets(vols, { ...world, voiceActive: true });
    expect(t.music).toBe(0.8);
    expect(t.ambient).toBeCloseTo(0.6 * DUCK_FACTOR);
  });

  it("master mute forces both loop targets to zero", () => {
    expect(loopTargets({ ...vols, muted: true }, world)).toEqual({
      music: 0,
      ambient: 0,
    });
  });
});

describe("fadeStep", () => {
  it("moves toward the target by dt/fadeMs of full scale", () => {
    expect(fadeStep(0, 1, 70, 700)).toBeCloseTo(0.1);
    expect(fadeStep(1, 0, 70, 700)).toBeCloseTo(0.9);
  });

  it("lands exactly on the target instead of overshooting", () => {
    expect(fadeStep(0.95, 1, 70, 700)).toBe(1);
    expect(fadeStep(0.05, 0, 70, 700)).toBe(0);
  });

  it("a full fade completes in ~fadeMs regardless of tick size", () => {
    let v = 0;
    for (let i = 0; i < 10; i++) v = fadeStep(v, 1, 70, 700);
    expect(v).toBeCloseTo(1, 10); // float accumulation: within 1e-10 after fadeMs
    expect(fadeStep(v, 1, 70, 700)).toBe(1); // …and exact on the next tick
    expect(fadeStep(1, 0, 700, 700)).toBe(0); // one whole-fade tick lands exactly
  });

  it("is stable at the target and clamps degenerate inputs", () => {
    expect(fadeStep(0.5, 0.5, 50, 700)).toBe(0.5);
    expect(fadeStep(0.5, 1, 0, 700)).toBe(0.5); // zero dt: no movement
    expect(fadeStep(0.2, 0.9, 50, 0)).toBe(0.9); // zero fade: jump to target
    expect(fadeStep(-1, 2, 50, 700)).toBeGreaterThanOrEqual(0); // clamped domain
  });

  it("uses LOOP_FADE_MS by default", () => {
    expect(fadeStep(0, 1, LOOP_FADE_MS)).toBe(1);
    expect(fadeStep(0, 1, LOOP_FADE_MS / 2)).toBeCloseTo(0.5);
  });
});
