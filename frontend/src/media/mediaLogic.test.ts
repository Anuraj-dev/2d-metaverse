import { describe, it, expect } from "vitest";
import {
  worldRoomName,
  roomRoomName,
  stageRoomName,
  subscribeAction,
  unsubscribeAction,
  computeVolumes,
  computeZonedVolumes,
  rampVolume,
  rampVolumes,
  AUDIO_CUTOFF,
  VOICE_RAMP_MS,
  type RoomMode,
  type SubscribeAction,
  type UnsubscribeAction,
  type MediaPos,
  type ZonedVolume,
  type VolumeRampState,
} from "./mediaLogic";

describe("room name builders", () => {
  it("namespaces world / room / stage by id", () => {
    expect(worldRoomName("1")).toBe("world:1");
    expect(roomRoomName("D")).toBe("room:D");
    expect(stageRoomName("1")).toBe("stage:1");
  });
});

describe("track routing — subscribe matrix", () => {
  const matrix: Array<["audio" | "video", RoomMode, SubscribeAction]> = [
    // world (proximity) room: mic-only — audio starts silent, video is ignored
    ["audio", "world-audio", "attach-audio-silent"],
    ["video", "world-audio", "ignore"],
    // private room: video surfaces to the UI, audio attaches at full volume
    ["video", "room-av", "surface-video"],
    ["audio", "room-av", "attach-audio"],
    // stage broadcast (PRD 17): video surfaces, audio attaches at the FIXED volume
    ["video", "stage-audience", "surface-video"],
    ["audio", "stage-audience", "attach-audio-fixed"],
  ];
  it.each(matrix)("%s track in %s room → %s", (kind, mode, action) => {
    expect(subscribeAction(kind, mode)).toBe(action);
  });
});

describe("track routing — unsubscribe matrix", () => {
  const matrix: Array<["audio" | "video", RoomMode, UnsubscribeAction]> = [
    ["video", "room-av", "drop-video"],
    ["audio", "room-av", "detach-audio"],
    ["video", "stage-audience", "drop-video"],
    ["audio", "stage-audience", "detach-audio"],
    // world room never surfaced video, so everything just detaches
    ["audio", "world-audio", "detach-audio"],
    ["video", "world-audio", "detach-audio"],
  ];
  it.each(matrix)("%s track in %s room → %s", (kind, mode, action) => {
    expect(unsubscribeAction(kind, mode)).toBe(action);
  });
});

describe("computeVolumes", () => {
  const me: MediaPos = { id: "me", x: 0, y: 0 };

  it("returns null when the local position is unknown", () => {
    expect(computeVolumes([{ id: "a", x: 10, y: 0 }], "me", ["a"])).toBeNull();
  });

  it("finds self via the `self` flag when id doesn't match", () => {
    const players: MediaPos[] = [
      { id: "sock-xyz", self: true, x: 0, y: 0 },
      { id: "a", x: 0, y: 0 },
    ];
    const vols = computeVolumes(players, "different", ["a"]);
    expect(vols?.get("a")).toBe(1);
  });

  it("is full volume when touching and silent at the cutoff", () => {
    const players: MediaPos[] = [
      me,
      { id: "near", x: 0, y: 0 },
      { id: "far", x: AUDIO_CUTOFF, y: 0 },
    ];
    const vols = computeVolumes(players, "me", ["near", "far"]);
    expect(vols?.get("near")).toBe(1);
    expect(vols?.get("far")).toBe(0);
  });

  it("scales linearly with distance", () => {
    const players: MediaPos[] = [me, { id: "mid", x: AUDIO_CUTOFF / 2, y: 0 }];
    expect(computeVolumes(players, "me", ["mid"])?.get("mid")).toBeCloseTo(0.5);
  });

  it("silences a subscribed remote whose position is unknown", () => {
    const vols = computeVolumes([me], "me", ["ghost"]);
    expect(vols?.get("ghost")).toBe(0);
  });

  it("only reports the subscribed set, not every player", () => {
    const players: MediaPos[] = [me, { id: "a", x: 10, y: 0 }, { id: "b", x: 10, y: 0 }];
    const vols = computeVolumes(players, "me", ["a"]);
    expect([...(vols?.keys() ?? [])]).toEqual(["a"]);
  });

  it("honours a custom cutoff", () => {
    const players: MediaPos[] = [me, { id: "a", x: 50, y: 0 }];
    expect(computeVolumes(players, "me", ["a"], 100)?.get("a")).toBeCloseTo(0.5);
  });

  it("silences a point-blank remote in a different zone (no voice through walls)", () => {
    const players: MediaPos[] = [
      { id: "me", x: 0, y: 0, zone: "outdoor" },
      { id: "inside", x: 1, y: 0, zone: "roomA" },
    ];
    expect(computeVolumes(players, "me", ["inside"])?.get("inside")).toBe(0);
  });

  it("keeps the distance falloff for a remote sharing the local zone", () => {
    const players: MediaPos[] = [
      { id: "me", x: 0, y: 0, zone: "roomA" },
      { id: "mate", x: AUDIO_CUTOFF / 2, y: 0, zone: "roomA" },
    ];
    expect(computeVolumes(players, "me", ["mate"])?.get("mate")).toBeCloseTo(0.5);
  });

  it("keeps a same-room teammate audible past the cutoff (the big-room silence bug)", () => {
    // Opposite ends of a room wider than AUDIO_CUTOFF (the campus hostel rooms):
    // the shared-room floor must keep them audible, not silence them by distance.
    const players: MediaPos[] = [
      { id: "me", x: 0, y: 0, zone: "roomA" },
      { id: "mate", x: AUDIO_CUTOFF * 1.5, y: 0, zone: "roomA" },
    ];
    expect(computeVolumes(players, "me", ["mate"])?.get("mate")).toBeGreaterThan(0);
  });

  it("treats a missing zone as outdoor (unchanged pre-PRD behaviour)", () => {
    const players: MediaPos[] = [me, { id: "a", x: 0, y: 0 }];
    expect(computeVolumes(players, "me", ["a"])?.get("a")).toBe(1);
  });

  it("mutes a live stage performer's proximity track (PRD 17 dedupe)", () => {
    // A point-blank remote who would normally be full volume is silenced when
    // they are a live stage performer — the listener hears the broadcast instead.
    const players: MediaPos[] = [me, { id: "star", x: 0, y: 0 }];
    expect(computeVolumes(players, "me", ["star"], AUDIO_CUTOFF, ["star"])?.get("star")).toBe(0);
  });

  it("only dedupes the listed performers, leaving other nearby voices audible", () => {
    const players: MediaPos[] = [me, { id: "star", x: 0, y: 0 }, { id: "mate", x: 0, y: 0 }];
    const vols = computeVolumes(players, "me", ["star", "mate"], AUDIO_CUTOFF, ["star"]);
    expect(vols?.get("star")).toBe(0);
    expect(vols?.get("mate")).toBe(1);
  });
});

describe("computeZonedVolumes (PRD 21: zoneKey + instant signal for the ramp layer)", () => {
  const me: MediaPos = { id: "me", x: 0, y: 0 };

  it("agrees with computeVolumes on the target volume", () => {
    const players: MediaPos[] = [
      { id: "me", x: 0, y: 0, zone: "roomA" },
      { id: "mate", x: AUDIO_CUTOFF / 2, y: 0, zone: "roomA" },
    ];
    const zoned = computeZonedVolumes(players, "me", ["mate"]);
    const plain = computeVolumes(players, "me", ["mate"]);
    expect(zoned?.get("mate")?.volume).toBe(plain?.get("mate"));
  });

  it("returns null when the local position is unknown (matches computeVolumes)", () => {
    expect(computeZonedVolumes([{ id: "a", x: 10, y: 0 }], "me", ["a"])).toBeNull();
  });

  it("keys same-zone pairs identically regardless of distance", () => {
    const players: MediaPos[] = [
      { id: "me", x: 0, y: 0, zone: "outdoor" },
      { id: "a", x: 10, y: 0, zone: "outdoor" },
    ];
    const z = computeZonedVolumes(players, "me", ["a"])?.get("a");
    expect(z?.zoneKey).toBe("outdoor|outdoor");
    expect(z?.instant).toBe(false);
  });

  it("keys a cross-zone pair distinctly from a same-zone pair", () => {
    const outdoor: MediaPos[] = [
      { id: "me", x: 0, y: 0, zone: "outdoor" },
      { id: "a", x: 1, y: 0, zone: "roomA" },
    ];
    const sameZone: MediaPos[] = [
      { id: "me", x: 0, y: 0, zone: "roomA" },
      { id: "a", x: 1, y: 0, zone: "roomA" },
    ];
    const crossKey = computeZonedVolumes(outdoor, "me", ["a"])?.get("a")?.zoneKey;
    const sameKey = computeZonedVolumes(sameZone, "me", ["a"])?.get("a")?.zoneKey;
    expect(crossKey).not.toBe(sameKey);
  });

  it("room-to-room (both same zone id, different room) keys distinctly", () => {
    const roomA: MediaPos[] = [
      { id: "me", x: 0, y: 0, zone: "roomA" },
      { id: "a", x: 1, y: 0, zone: "roomA" },
    ];
    const roomB: MediaPos[] = [
      { id: "me", x: 0, y: 0, zone: "roomB" },
      { id: "a", x: 1, y: 0, zone: "roomB" },
    ];
    const keyA = computeZonedVolumes(roomA, "me", ["a"])?.get("a")?.zoneKey;
    const keyB = computeZonedVolumes(roomB, "me", ["a"])?.get("a")?.zoneKey;
    expect(keyA).not.toBe(keyB);
  });

  it("marks a stage-performer dedupe as instant", () => {
    const players: MediaPos[] = [me, { id: "star", x: 0, y: 0 }];
    const z = computeZonedVolumes(players, "me", ["star"], AUDIO_CUTOFF, ["star"])?.get("star");
    expect(z?.volume).toBe(0);
    expect(z?.instant).toBe(true);
  });

  it("marks an unknown (not-yet-positioned) remote as instant", () => {
    const z = computeZonedVolumes([me], "me", ["ghost"])?.get("ghost");
    expect(z?.volume).toBe(0);
    expect(z?.instant).toBe(true);
  });
});

describe("rampVolume (PRD 21: exponential same-zone glide, instant zone snap)", () => {
  const zoned = (volume: number, zoneKey = "outdoor|outdoor", instant = false): ZonedVolume => ({
    volume,
    zoneKey,
    instant,
  });

  it("snaps to target when there is no prior state (newly-subscribed remote)", () => {
    const r = rampVolume(undefined, zoned(0.8), 100);
    expect(r).toEqual({ applied: 0.8, zoneKey: "outdoor|outdoor" });
  });

  it("glides part-way toward the target when the zone pairing is unchanged", () => {
    const prev: VolumeRampState = { applied: 0, zoneKey: "outdoor|outdoor" };
    const r = rampVolume(prev, zoned(1), 100);
    // exp(-100/500) ≈ 0.8187 of the gap remains, so ~0.181 of the way there.
    expect(r.applied).toBeGreaterThan(0);
    expect(r.applied).toBeLessThan(1);
    expect(r.applied).toBeCloseTo(1 - Math.exp(-100 / VOICE_RAMP_MS), 6);
  });

  it("never overshoots the target while gliding", () => {
    const prev: VolumeRampState = { applied: 0.9, zoneKey: "outdoor|outdoor" };
    const r = rampVolume(prev, zoned(1), 50);
    expect(r.applied).toBeGreaterThan(0.9);
    expect(r.applied).toBeLessThanOrEqual(1);
  });

  it("snaps instantly the moment the zone pairing changes (privacy invariant)", () => {
    const prev: VolumeRampState = { applied: 0.9, zoneKey: "outdoor|outdoor" };
    // Distance-wise this looks like a small change, but the zone gate moved —
    // a room boundary was crossed, so it must cut, never glide.
    const r = rampVolume(prev, zoned(0, "outdoor|roomA"), 16);
    expect(r).toEqual({ applied: 0, zoneKey: "outdoor|roomA" });
  });

  it("snaps instantly on a room-to-room transition (same-zone in, different-zone out)", () => {
    const prev: VolumeRampState = { applied: 0.5, zoneKey: "roomA|roomA" };
    const r = rampVolume(prev, zoned(0.5, "roomB|roomB"), 16);
    expect(r).toEqual({ applied: 0.5, zoneKey: "roomB|roomB" });
  });

  it("snaps instantly when the target is marked instant, even with an unchanged zoneKey", () => {
    const prev: VolumeRampState = { applied: 1, zoneKey: "outdoor|outdoor" };
    const r = rampVolume(prev, zoned(0, "outdoor|outdoor", true), 16);
    expect(r.applied).toBe(0);
  });

  it("converges to the target over repeated ticks", () => {
    let state: VolumeRampState = { applied: 0, zoneKey: "outdoor|outdoor" };
    for (let i = 0; i < 50; i++) state = rampVolume(state, zoned(1), 100);
    expect(state.applied).toBeCloseTo(1, 3);
  });

  it("is frame-rate independent: two half-steps compose to one full step", () => {
    const prev: VolumeRampState = { applied: 0.2, zoneKey: "outdoor|outdoor" };
    const target = zoned(0.9);
    const oneStep = rampVolume(prev, target, 200);
    const twoSteps = rampVolume(rampVolume(prev, target, 100), target, 100);
    expect(twoSteps.applied).toBeCloseTo(oneStep.applied, 10);
  });

  it("zero dt makes no movement", () => {
    const prev: VolumeRampState = { applied: 0.3, zoneKey: "outdoor|outdoor" };
    const r = rampVolume(prev, zoned(1), 0);
    expect(r.applied).toBeCloseTo(0.3, 10);
  });

  it("a non-positive ramp time constant snaps to the target", () => {
    const prev: VolumeRampState = { applied: 0.3, zoneKey: "outdoor|outdoor" };
    const r = rampVolume(prev, zoned(1), 100, 0);
    expect(r.applied).toBe(1);
  });
});

describe("rampVolumes (map-level integration)", () => {
  it("ramps every subscribed remote independently", () => {
    const prev = new Map<string, VolumeRampState>([
      ["a", { applied: 0, zoneKey: "outdoor|outdoor" }],
      ["b", { applied: 1, zoneKey: "outdoor|outdoor" }],
    ]);
    const targets = new Map<string, ZonedVolume>([
      ["a", { volume: 1, zoneKey: "outdoor|outdoor", instant: false }],
      ["b", { volume: 0, zoneKey: "outdoor|outdoor", instant: false }],
    ]);
    const next = rampVolumes(prev, targets, 100);
    expect(next.get("a")?.applied).toBeGreaterThan(0);
    expect(next.get("a")?.applied).toBeLessThan(1);
    expect(next.get("b")?.applied).toBeGreaterThan(0);
    expect(next.get("b")?.applied).toBeLessThan(1);
  });

  it("drops ramp state for remotes no longer in the target set (unsubscribed)", () => {
    const prev = new Map<string, VolumeRampState>([
      ["a", { applied: 0.5, zoneKey: "outdoor|outdoor" }],
      ["gone", { applied: 0.5, zoneKey: "outdoor|outdoor" }],
    ]);
    const targets = new Map<string, ZonedVolume>([
      ["a", { volume: 0.5, zoneKey: "outdoor|outdoor", instant: false }],
    ]);
    const next = rampVolumes(prev, targets, 100);
    expect([...next.keys()]).toEqual(["a"]);
  });

  it("a remote reappearing after unsubscribe snaps (no stale glide)", () => {
    const targets = new Map<string, ZonedVolume>([
      ["a", { volume: 1, zoneKey: "outdoor|outdoor", instant: false }],
    ]);
    // Empty prev — as if "a" just resubscribed with no carried ramp state.
    const next = rampVolumes(new Map(), targets, 100);
    expect(next.get("a")?.applied).toBe(1);
  });
});
