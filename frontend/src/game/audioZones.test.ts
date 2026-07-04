import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import {
  OUTDOOR_ZONE,
  ROOM_AUDIO_FLOOR,
  zoneAt,
  zoneVolume,
  roomAreasFromObjects,
  type TiledObjectLike,
} from "./audioZones";
import { proximityVolume } from "./proximity";
import type { RoomArea } from "./zones";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* --------------------------------- zoneVolume -------------------------------- */
describe("zoneVolume — the isolation rule", () => {
  const CUT = 200;

  // (myZone, theirZone, distance) → expected volume. A shared room keeps the
  // distance gradient but never falls below ROOM_AUDIO_FLOOR (an enclosed room
  // is always audible); the outdoor zone keeps the true falloff to zero;
  // different zones are always silent regardless of distance.
  const cases: Array<[string, string, string, number, number]> = [
    // same room: distance gradient above the floor is unchanged…
    ["same room, touching", "roomA", "roomA", 0, 1],
    ["same room, mid-range", "roomA", "roomA", CUT / 2, 0.5],
    // …but a shared room never goes silent — floored at/beyond the cutoff.
    ["same room, at cutoff (floored, not silent)", "roomA", "roomA", CUT, ROOM_AUDIO_FLOOR],
    ["same room, far beyond cutoff (still floored)", "roomA", "roomA", CUT * 2, ROOM_AUDIO_FLOOR],
    // outdoor is the open world: falloff all the way to zero.
    ["outdoor, mid-range falloff", OUTDOOR_ZONE, OUTDOOR_ZONE, 40, 0.8],
    ["outdoor, at cutoff (silent)", OUTDOOR_ZONE, OUTDOOR_ZONE, CUT, 0],
    // different zones: the doors-bug of audio — must be 0 even point-blank
    ["adjacent through a wall (point-blank)", "roomA", OUTDOOR_ZONE, 1, 0],
    ["adjacent through a wall (mid-range)", "roomA", OUTDOOR_ZONE, CUT / 2, 0],
    ["two different rooms", "roomA", "roomB", 10, 0],
    ["room vs outdoor", "roomA", OUTDOOR_ZONE, 0, 0],
    ["outdoor vs room", OUTDOOR_ZONE, "roomA", 0, 0],
  ];

  it.each(cases)("%s", (_label, mine, theirs, distance, expected) => {
    expect(zoneVolume(mine, theirs, distance, CUT)).toBeCloseTo(expected);
  });

  it("a shared room is never silent — any distance is at least the floor", () => {
    for (const d of [0, 50, 200, 400, 10_000]) {
      expect(zoneVolume("roomA", "roomA", d, CUT)).toBeGreaterThanOrEqual(ROOM_AUDIO_FLOOR);
    }
  });

  it("outdoor voice is byte-for-byte the pre-PRD proximity falloff (reaches 0)", () => {
    for (const d of [0, 25, 60, 137, 199, 200, 260]) {
      expect(zoneVolume(OUTDOOR_ZONE, OUTDOOR_ZONE, d, CUT)).toBe(proximityVolume(d, CUT));
    }
  });

  it("honours a custom cutoff within a shared zone (above the floor)", () => {
    expect(zoneVolume("z", "z", 50, 100)).toBeCloseTo(0.5);
  });
});

/* ----------------------------------- zoneAt ---------------------------------- */
describe("zoneAt — point → zone", () => {
  // Two rooms sharing a wall at x=100; everything else is outdoor.
  const rooms: RoomArea[] = [
    { roomId: "roomA", rect: { x: 0, y: 0, width: 100, height: 100 } },
    { roomId: "roomB", rect: { x: 100, y: 0, width: 100, height: 100 } },
  ];

  it("returns the containing room's id", () => {
    expect(zoneAt(rooms, 50, 50)).toBe("roomA");
    expect(zoneAt(rooms, 150, 50)).toBe("roomB");
  });

  it("returns OUTDOOR_ZONE when inside no room", () => {
    expect(zoneAt(rooms, 500, 500)).toBe(OUTDOOR_ZONE);
    expect(zoneAt(rooms, 50, 200)).toBe(OUTDOOR_ZONE);
  });

  it("is a binary cutover at the doorway threshold (inclusive edges)", () => {
    // A point just inside roomA is roomA; one pixel past its right edge (with a
    // gap to roomB) is outdoor — no muffled in-between band.
    expect(zoneAt([rooms[0]!], 100, 50)).toBe("roomA"); // on the edge → inside
    expect(zoneAt([rooms[0]!], 101, 50)).toBe(OUTDOOR_ZONE); // one px past → outdoor
  });

  it("treats an empty zone list as entirely outdoor", () => {
    expect(zoneAt([], 10, 10)).toBe(OUTDOOR_ZONE);
  });
});

/* ---------------------------- roomAreasFromObjects --------------------------- */
describe("roomAreasFromObjects — derivation from Tiled objects", () => {
  it("builds one RoomArea per object carrying a roomId", () => {
    const objs: TiledObjectLike[] = [
      { x: 10, y: 20, width: 30, height: 40, properties: [{ name: "roomId", value: "7" }] },
    ];
    expect(roomAreasFromObjects(objs)).toEqual([
      { roomId: "7", rect: { x: 10, y: 20, width: 30, height: 40 } },
    ]);
  });

  it("coerces a numeric roomId to a string id", () => {
    const objs: TiledObjectLike[] = [
      { x: 0, y: 0, width: 1, height: 1, properties: [{ name: "roomId", value: 3 }] },
    ];
    expect(roomAreasFromObjects(objs)[0]?.roomId).toBe("3");
  });

  it("skips objects with no usable roomId", () => {
    const objs: TiledObjectLike[] = [
      { x: 0, y: 0, width: 1, height: 1 }, // no properties
      { x: 0, y: 0, width: 1, height: 1, properties: [{ name: "other", value: "x" }] },
      { x: 0, y: 0, width: 1, height: 1, properties: [{ name: "roomId", value: "" }] },
    ];
    expect(roomAreasFromObjects(objs)).toEqual([]);
  });
});

/* -------------------- derivation cross-check vs real map data ---------------- */
// Mirrors maps.test.ts: read each map's Tiled JSON off disk and assert the
// zones derived from its `roomBounds` layer match the rooms authored there.
interface TiledMap {
  layers: { name: string; objects?: TiledObjectLike[] }[];
}

const MAP_ROOMS: Record<string, string[]> = {
  // Campus is the single canonical map (PRD 13): hostel rooms 1-3 + HQ rooms 4-6.
  // The PRD 16 arcade hall is intentionally NOT a roomBounds (public walk-in, no
  // audio zone) so it stays out of the locked-room rollback — see maps.test.ts.
  campus: ["1", "2", "3", "4", "5", "6"],
};

function loadRoomBounds(mapKey: string): TiledObjectLike[] {
  const jsonPath = resolve(__dirname, "../../public/assets/maps", `${mapKey}.json`);
  const json = JSON.parse(readFileSync(jsonPath, "utf-8")) as TiledMap;
  const layer = json.layers.find((l) => l.name === "roomBounds");
  if (!layer) throw new Error(`map "${mapKey}" has no roomBounds layer`);
  return layer.objects ?? [];
}

describe("zone derivation against the real map data", () => {
  for (const [mapKey, expectedRooms] of Object.entries(MAP_ROOMS)) {
    describe(`map "${mapKey}"`, () => {
      const zones = roomAreasFromObjects(loadRoomBounds(mapKey));

      it("derives exactly the rooms authored in roomBounds", () => {
        const ids = zones.map((z) => z.roomId).sort();
        expect(ids).toEqual([...expectedRooms].sort());
      });

      it("every room's centre resolves to its own zone", () => {
        for (const z of zones) {
          const cx = z.rect.x + z.rect.width / 2;
          const cy = z.rect.y + z.rect.height / 2;
          expect(zoneAt(zones, cx, cy)).toBe(z.roomId);
        }
      });

      it("a point outside every room is outdoor", () => {
        // Far below/right of any authored room rect on these maps.
        expect(zoneAt(zones, 8, 8)).toBe(OUTDOOR_ZONE);
      });

      it("two players in different rooms cannot hear each other", () => {
        const [a, b] = zones;
        if (!a || !b) throw new Error(`map "${mapKey}" needs >=2 rooms for this check`);
        const za = zoneAt(zones, a.rect.x + a.rect.width / 2, a.rect.y + a.rect.height / 2);
        const zb = zoneAt(zones, b.rect.x + b.rect.width / 2, b.rect.y + b.rect.height / 2);
        expect(zoneVolume(za, zb, 5)).toBe(0);
      });

      // Regression: every campus room is wider than AUDIO_CUTOFF (200px) — the
      // largest hostel room spans a ~280px diagonal — so before the room floor
      // two players at opposite corners of the *same* room were muted purely by
      // distance. Assert the whole span of every room stays audible.
      it("two players anywhere in the same room can always hear each other", () => {
        for (const z of zones) {
          const diagonal = Math.hypot(z.rect.width, z.rect.height);
          expect(diagonal).toBeGreaterThan(200); // documents WHY the floor is needed
          // Both corners resolve to this room (rect edges are inclusive), so the
          // pair shares the zone and the room floor must keep them audible.
          const near = zoneAt(zones, z.rect.x, z.rect.y);
          const far = zoneAt(zones, z.rect.x + z.rect.width, z.rect.y + z.rect.height);
          expect(near).toBe(z.roomId);
          expect(far).toBe(z.roomId);
          expect(zoneVolume(near, far, diagonal)).toBeGreaterThan(0);
        }
      });
    });
  }
});
