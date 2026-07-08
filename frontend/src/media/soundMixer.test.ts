import { describe, it, expect } from "vitest";
import {
  channelGain,
  clamp01,
  volumesFromSettings,
  speechActive,
  duckStep,
  cueForEvent,
  EVENT_SOUNDS,
  footstepDue,
  fadeStep,
  loopTargets,
  DUCK_FACTOR,
  DUCK_ATTACK_MS,
  DUCK_RELEASE_MS,
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
  arcade: 1,
  muted: false,
  muteSfx: false,
  muteArcade: false,
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
    expect(channelGain(v, "arcade")).toBe(1);
  });

  it("scales the arcade channel by its own volume under the master", () => {
    const v = { ...base, master: 0.5, arcade: 0.6 };
    expect(channelGain(v, "arcade")).toBeCloseTo(0.3);
  });

  it("muteArcade silences only the arcade channel", () => {
    const v = { ...base, muteArcade: true };
    expect(channelGain(v, "arcade")).toBe(0);
    expect(channelGain(v, "sfx")).toBe(1);
    expect(channelGain(v, "music")).toBe(1);
    expect(channelGain(v, "ambient")).toBe(1);
  });

  it("master mute also silences the arcade channel", () => {
    expect(channelGain({ ...base, muted: true }, "arcade")).toBe(0);
  });

  it("returns the un-ducked base gain — ducking is a loop-only envelope, not here", () => {
    // channelGain no longer applies any duck; every channel is its plain base.
    expect(channelGain(base, "ambient")).toBe(1);
    expect(channelGain(base, "music")).toBe(1);
    expect(channelGain(base, "sfx")).toBe(1);
  });

  it("clamps out-of-range channel volumes", () => {
    expect(channelGain({ ...base, sfx: 5 }, "sfx")).toBe(1);
    expect(channelGain({ ...base, master: 5, music: 5 }, "music")).toBe(1);
  });
});

describe("volumesFromSettings (persistence round-trip)", () => {
  it("mirrors the persisted default settings shape", () => {
    const v = volumesFromSettings(getSettings());
    // defaults: master .6, music .4, sfx .7, ambient .5, arcade .8
    expect(channelGain(v, "music")).toBeCloseTo(0.6 * 0.4);
    expect(channelGain(v, "sfx")).toBeCloseTo(0.6 * 0.7);
    expect(channelGain(v, "ambient")).toBeCloseTo(0.6 * 0.5);
    expect(channelGain(v, "arcade")).toBeCloseTo(0.6 * 0.8);
  });
});

describe("speechActive (speech-driven duck trigger)", () => {
  const set = (...ids: string[]): ReadonlySet<string> => new Set(ids);
  const SELF = "me";

  it("no peers audible and no one speaking → no duck", () => {
    expect(speechActive(set(), {}, SELF)).toBe(false);
  });

  it("audible peer near but silent → no duck (mere proximity never ducks)", () => {
    expect(speechActive(set(), { a: 0.9 }, SELF)).toBe(false);
  });

  it("audible peer speaking → duck", () => {
    expect(speechActive(set("a"), { a: 0.9 }, SELF)).toBe(true);
  });

  it("peer speaking but below the audible threshold (distant/walled-off) → no duck", () => {
    expect(speechActive(set("a"), { a: VOICE_THRESHOLD - 0.001 }, SELF)).toBe(false);
    // exactly at the threshold still counts as audible
    expect(speechActive(set("a"), { a: VOICE_THRESHOLD }, SELF)).toBe(true);
  });

  it("peer speaking with no known volume (not in the map) → no duck", () => {
    expect(speechActive(set("a"), {}, SELF)).toBe(false);
  });

  it("self speaking → duck even with no audible peers (self has no proximity volume)", () => {
    expect(speechActive(set(SELF), {}, SELF)).toBe(true);
  });

  it("only a distant peer speaks while an audible peer stays silent → no duck", () => {
    expect(speechActive(set("far"), { far: 0.01, near: 0.9 }, SELF)).toBe(false);
  });

  it("muted local player (not in the speaking set) with no audible speakers → no duck", () => {
    expect(speechActive(set("far"), { far: 0.01 }, SELF)).toBe(false);
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
    expect(cueForEvent("arcade-point")).toEqual({ clip: "arcade_point", channel: "arcade" });
    expect(cueForEvent("open-arcade")).toEqual({ clip: "arcade_start", channel: "arcade" });
    expect(cueForEvent("stage-on-air")).toEqual({ clip: "meeting_join", channel: "sfx" });
    expect(cueForEvent("stage-off-air")).toEqual({ clip: "meeting_leave", channel: "sfx" });
    // Screen share (PRD 23).
    expect(cueForEvent("screen-share-on")).toEqual({ clip: "door_open", channel: "sfx" });
    expect(cueForEvent("screen-share-off")).toEqual({ clip: "door_close", channel: "sfx" });
  });
  it("returns null for unmapped events", () => {
    expect(cueForEvent("leave-door")).toBeNull();
    expect(cueForEvent("positions")).toBeNull();
  });
  it("every mapped cue names a real channel", () => {
    for (const cue of Object.values(EVENT_SOUNDS)) {
      expect(["music", "sfx", "ambient", "arcade"]).toContain(cue.channel);
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

describe("loopTargets (base loop lifecycle: outdoors / meeting — un-ducked)", () => {
  const vols = { ...base, music: 0.8, ambient: 0.6 };
  const world = { outdoors: true, meeting: false };

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

  it("meeting wins even while outdoors", () => {
    expect(loopTargets(vols, { outdoors: true, meeting: true })).toEqual({
      music: 0,
      ambient: 0,
    });
  });

  it("does not apply any duck — the duck lives in the separate duckStep envelope", () => {
    // Same inputs, regardless of speech: base targets never fold in DUCK_FACTOR.
    expect(loopTargets(vols, world)).toEqual({ music: 0.8, ambient: 0.6 });
  });

  it("master mute forces both loop targets to zero", () => {
    expect(loopTargets({ ...vols, muted: true }, world)).toEqual({
      music: 0,
      ambient: 0,
    });
  });
});

describe("duckStep (speech duck envelope: fast attack / slow release)", () => {
  // Speed is normalized over the FULL duck span (1 - DUCK_FACTOR), so a fraction f
  // of the attack/release window traverses exactly f of the span (intended contract).
  const SPAN = 1 - DUCK_FACTOR;

  it("attack: half the attack window traverses half the span downward", () => {
    // 50ms of a 100ms attack ⇒ half the span down from open (1).
    expect(duckStep(1, true, DUCK_ATTACK_MS / 2)).toBeCloseTo(1 - SPAN / 2);
  });

  it("release: a tenth of the release window traverses a tenth of the span upward", () => {
    // 70ms of a 700ms release ⇒ 0.1 of the span up from the ducked floor.
    expect(duckStep(DUCK_FACTOR, false, DUCK_RELEASE_MS / 10)).toBeCloseTo(
      DUCK_FACTOR + SPAN / 10
    );
  });

  it("attack is faster than release for the same dt (asymmetric envelope)", () => {
    const downMove = 1 - duckStep(1, true, 30);
    const upMove = duckStep(DUCK_FACTOR, false, 30) - DUCK_FACTOR;
    expect(downMove).toBeGreaterThan(upMove);
  });

  it("a complete attack takes exactly DUCK_ATTACK_MS (full-span traverse)", () => {
    expect(duckStep(1, true, DUCK_ATTACK_MS)).toBe(DUCK_FACTOR);
    // …and just under a full window has NOT yet reached the floor.
    expect(duckStep(1, true, DUCK_ATTACK_MS - 1)).toBeGreaterThan(DUCK_FACTOR);
  });

  it("a complete release takes exactly DUCK_RELEASE_MS (full-span traverse)", () => {
    expect(duckStep(DUCK_FACTOR, false, DUCK_RELEASE_MS)).toBe(1);
    expect(duckStep(DUCK_FACTOR, false, DUCK_RELEASE_MS - 1)).toBeLessThan(1);
  });

  it("is stable once settled at either end", () => {
    expect(duckStep(DUCK_FACTOR, true, 50)).toBe(DUCK_FACTOR);
    expect(duckStep(1, false, 50)).toBe(1);
  });

  it("clamps a degenerate current into the duck range", () => {
    expect(duckStep(5, false, 0)).toBe(1); // above range, zero dt ⇒ target(open)
    expect(duckStep(-1, true, 0)).toBe(DUCK_FACTOR); // below range, zero dt ⇒ target(ducked)
    expect(duckStep(NaN, false, 50)).toBe(1); // NaN treated as open, already at rest
  });

  it("a full release completes in ~DUCK_RELEASE_MS worth of 50ms ticks", () => {
    let v = DUCK_FACTOR;
    let ticks = 0;
    while (v < 1 && ticks < 100) {
      v = duckStep(v, false, 50);
      ticks++;
    }
    expect(v).toBe(1);
    // Full span over 700ms in 50ms steps ⇒ 14 ticks; allow ±1 for float rounding.
    expect(Math.abs(ticks - DUCK_RELEASE_MS / 50)).toBeLessThanOrEqual(1);
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
