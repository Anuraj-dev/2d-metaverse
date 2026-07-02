import { describe, it, expect } from "vitest";
import {
  worldRoomName,
  roomRoomName,
  stageRoomName,
  subscribeAction,
  unsubscribeAction,
  computeVolumes,
  AUDIO_CUTOFF,
  type RoomMode,
  type SubscribeAction,
  type UnsubscribeAction,
  type MediaPos,
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
    // private room / stage: video surfaces to the UI, audio attaches at full volume
    ["video", "room-av", "surface-video"],
    ["audio", "room-av", "attach-audio"],
  ];
  it.each(matrix)("%s track in %s room → %s", (kind, mode, action) => {
    expect(subscribeAction(kind, mode)).toBe(action);
  });
});

describe("track routing — unsubscribe matrix", () => {
  const matrix: Array<["audio" | "video", RoomMode, UnsubscribeAction]> = [
    ["video", "room-av", "drop-video"],
    ["audio", "room-av", "detach-audio"],
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

  it("treats a missing zone as outdoor (unchanged pre-PRD behaviour)", () => {
    const players: MediaPos[] = [me, { id: "a", x: 0, y: 0 }];
    expect(computeVolumes(players, "me", ["a"])?.get("a")).toBe(1);
  });
});
