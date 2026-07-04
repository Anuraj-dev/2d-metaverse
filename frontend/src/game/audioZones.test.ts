import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import {
  OUTDOOR_ZONE,
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

  // (myZone, theirZone, distance) → expected volume. Same zone keeps the
  // linear falloff; different zones are always silent regardless of distance.
  const cases: Array<[string, string, string, number, number]> = [
    // same-zone: unchanged distance falloff (touching / mid / cutoff / beyond)
    ["same zone, touching", "roomA", "roomA", 0, 1],
    ["same zone, mid-range", "roomA", "roomA", CUT / 2, 0.5],
    ["same zone, at cutoff", "roomA", "roomA", CUT, 0],
    ["same zone, far outdoor", OUTDOOR_ZONE, OUTDOOR_ZONE, 40, 0.8],
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

  it("same-zone volume is byte-for-byte the pre-PRD proximity falloff", () => {
    for (const d of [0, 25, 60, 137, 199, 200, 260]) {
      expect(zoneVolume("z", "z", d, CUT)).toBe(proximityVolume(d, CUT));
    }
  });

  it("honours a custom cutoff within a shared zone", () => {
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
  // Campus is the single canonical map (PRD 13): hostel rooms 1-3 + HQ rooms 4-6,
  // plus the public "arcade" hall (PRD 16) which gets its own audio zone.
  campus: ["1", "2", "3", "4", "5", "6", "arcade"],
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
    });
  }
});
