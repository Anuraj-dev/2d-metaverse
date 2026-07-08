import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AREA_NAMES } from "@metaverse/shared";
import { MAPS, DEFAULT_MAP, activeMapKey, activeMap } from "./maps";
import { roomAreasFromObjects, zoneAt, type TiledObjectLike } from "./audioZones";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TILESETS_DIR = resolve(__dirname, "../../public/assets/tilesets");
const MAPS_DIR = resolve(__dirname, "../../public/assets/maps");

interface TiledTileset {
  firstgid: number;
  name: string;
  image: string;
  imagewidth: number;
  imageheight: number;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
}
interface TiledLayer {
  type: string;
  name: string;
  data?: number[];
}
interface TiledMap {
  tilesets: TiledTileset[];
  layers: TiledLayer[];
}

function loadMap(key: string): TiledMap {
  return JSON.parse(readFileSync(resolve(MAPS_DIR, `${key}.json`), "utf-8")) as TiledMap;
}

/** Read a PNG's pixel dimensions from its IHDR chunk (no image lib needed). */
function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file);
  // PNG signature (8 bytes) + IHDR length (4) + "IHDR" (4) then width/height.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubSearch(search: string) {
  vi.stubGlobal("window", { location: { search } } as unknown as Window);
}

describe("maps registry", () => {
  it("defaults to the campus map when no override", () => {
    stubSearch("");
    expect(activeMapKey()).toBe(DEFAULT_MAP);
    expect(activeMapKey()).toBe("campus");
    expect(activeMap()).toBe(MAPS.campus);
  });

  it("ignores an unknown map override (no legacy escape hatch)", () => {
    stubSearch("?map=nope");
    expect(activeMapKey()).toBe(DEFAULT_MAP);
  });

  it("campus references multiple tilesets including the existing one", () => {
    const campus = MAPS.campus;
    if (!campus) throw new Error("campus map is missing from MAPS");
    const keys = campus.tilesets.map((t) => t.key);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(keys).toContain("floors_walls");
    expect(keys).toContain("exterior");
  });

  it("every tileset key maps to a file", () => {
    for (const def of Object.values(MAPS)) {
      for (const ts of def.tilesets) {
        expect(ts.file).toMatch(/\.png$/);
      }
    }
  });

  it("every JSON tileset name matches a registry key (guards WorldScene addTilesetImage)", () => {
    for (const def of Object.values(MAPS)) {
      const json = loadMap(def.key);
      const registryKeys = new Set(def.tilesets.map((t) => t.key));
      for (const ts of json.tilesets) {
        expect(
          registryKeys.has(ts.name),
          `map "${def.key}": JSON tileset name "${ts.name}" not found in registry keys [${[...registryKeys].join(", ")}]`
        ).toBe(true);
      }
    }
  });
});

describe("tileset integrity (JSON ↔ image on disk)", () => {
  it("every registered tileset image exists and matches its JSON dimensions", () => {
    for (const def of Object.values(MAPS)) {
      const json = loadMap(def.key);
      const byName = new Map(json.tilesets.map((t) => [t.name, t]));
      for (const ref of def.tilesets) {
        const file = resolve(TILESETS_DIR, ref.file);
        expect(existsSync(file), `missing tileset image ${ref.file}`).toBe(true);
        const ts = byName.get(ref.key);
        if (!ts) throw new Error(`tileset ${ref.key} absent from map ${def.key} JSON`);
        const { width, height } = pngSize(file);
        expect(width, `${ref.file} width`).toBe(ts.imagewidth);
        expect(height, `${ref.file} height`).toBe(ts.imageheight);
        // tilecount must equal the grid the image actually holds
        const cols = Math.floor(ts.imagewidth / ts.tilewidth);
        const rows = Math.floor(ts.imageheight / ts.tileheight);
        expect(ts.columns, `${ref.key} columns`).toBe(cols);
        expect(ts.tilecount, `${ref.key} tilecount`).toBe(cols * rows);
      }
    }
  });

  it("every GID used in a tile layer resolves to a real tile in some tileset", () => {
    for (const def of Object.values(MAPS)) {
      const json = loadMap(def.key);
      const ranges = json.tilesets.map((t) => ({
        name: t.name,
        lo: t.firstgid,
        hi: t.firstgid + t.tilecount - 1,
      }));
      for (const layer of json.layers) {
        if (layer.type !== "tilelayer" || !layer.data) continue;
        for (const gid of layer.data) {
          if (gid === 0) continue;
          const ok = ranges.some((r) => gid >= r.lo && gid <= r.hi);
          expect(
            ok,
            `map "${def.key}" layer "${layer.name}": GID ${gid} is outside every tileset range`
          ).toBe(true);
        }
      }
    }
  });

  it("campus walls use solid tiles: floors_walls brick (never the broken trim strip, PRD 12 bug #1) or tree trunks", () => {
    const json = loadMap("campus");
    const walls = json.layers.find((l) => l.name === "walls");
    if (!walls?.data) throw new Error("campus walls layer missing");
    const fw = json.tilesets.find((t) => t.name === "floors_walls");
    if (!fw) throw new Error("floors_walls tileset missing");
    // Tree-trunk tiles (exterior.png gids 1021-1027) also live on the walls
    // layer — trunks are solid — and are the ONLY exterior tiles allowed
    // there (see gen_campus.py TRUNK_GIDS).
    const TRUNK_GIDS = new Set([1021, 1022, 1023, 1024, 1025, 1026, 1027]);
    const used = new Set(walls.data.filter((g) => g !== 0));
    expect(used.size).toBeGreaterThan(0);
    for (const gid of used) {
      if (TRUNK_GIDS.has(gid)) continue;
      // otherwise resolves within the floors_walls tileset
      expect(gid).toBeGreaterThanOrEqual(fw.firstgid);
      expect(gid).toBeLessThan(fw.firstgid + fw.tilecount);
      // never the top-row trim strip (local idx 0-17 → GIDs 1-18) that rendered
      // as broken brown stripes
      expect(gid - fw.firstgid, `wall GID ${gid} is a top-row trim tile`).toBeGreaterThan(17);
    }
  });
});

describe("campus arcade cabinets (PRD 11)", () => {
  interface TiledObject {
    name: string;
    properties?: { name: string; value: unknown }[];
  }
  interface ObjectLayer {
    name: string;
    type: string;
    objects?: TiledObject[];
  }
  function objects(layerName: string): TiledObject[] {
    const json = loadMap("campus") as unknown as { layers: ObjectLayer[] };
    return json.layers.find((l) => l.name === layerName)?.objects ?? [];
  }
  function prop(o: TiledObject, name: string): unknown {
    return o.properties?.find((p) => p.name === name)?.value;
  }

  const ARCADE_GAMES = new Set(["snake", "flappy", "2048"]);

  it("places exactly three arcade interactables, each with a valid game id + label", () => {
    const arcades = objects("interactables").filter((o) => prop(o, "interactType") === "arcade");
    expect(arcades).toHaveLength(3);
    const games = arcades.map((o) => prop(o, "game"));
    expect(new Set(games)).toEqual(ARCADE_GAMES);
    for (const o of arcades) {
      expect(typeof prop(o, "label")).toBe("string");
      expect(String(prop(o, "label")).length).toBeGreaterThan(0);
    }
  });

  it("backs each cabinet interactable with a solid cabinet sprite", () => {
    const furniture = objects("furniture");
    for (const game of ARCADE_GAMES) {
      const cabinet = furniture.find((o) => o.name === `f_arcade_${game}`);
      expect(cabinet, `missing cabinet sprite f_arcade_${game}`).toBeDefined();
      expect(prop(cabinet as TiledObject, "solid")).toBe(true);
    }
  });
});

describe("campus arcade hall (PRD 16)", () => {
  interface TiledObject {
    name: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    properties?: { name: string; value: unknown }[];
  }
  interface ObjectLayer {
    name: string;
    objects?: TiledObject[];
  }
  function objects(layerName: string): TiledObject[] {
    const json = loadMap("campus") as unknown as { layers: ObjectLayer[] };
    return json.layers.find((l) => l.name === layerName)?.objects ?? [];
  }
  function prop(o: TiledObject, name: string): unknown {
    return o.properties?.find((p) => p.name === name)?.value;
  }

  // The arcade hall is a public walk-in building: walls + open doorway, but NO
  // roomBounds / doorZone / seats. This is load-bearing — the locked-room
  // rollback bounces the player out of any roomBounds they aren't admitted to,
  // so a roomBounds here would make the hall unenterable.
  it("is a public, ungated hall: no roomBounds/doorZone/seats claim an 'arcade' room", () => {
    expect(objects("roomBounds").some((o) => prop(o, "roomId") === "arcade")).toBe(false);
    expect(objects("doorZones").some((o) => prop(o, "roomId") === "arcade")).toBe(false);
    expect(objects("seats").some((o) => prop(o, "roomId") === "arcade")).toBe(false);
    // And it does not accidentally reuse an existing private roomId's zone: the
    // canonical rooms stay exactly 1-6 (asserted in audioZones.test.ts).
  });

  it("relocates the three cabinets together into the southern hall (well clear of the plaza)", () => {
    const cabinets = objects("furniture").filter((o) => o.name.startsWith("f_arcade_"));
    expect(cabinets.length).toBe(3);
    for (const c of cabinets) {
      // Deep south of spawn (row 44 = 704px) — the cabinets moved out of the
      // old plaza cluster (~row 50) into the far-south hall (row 96 = 1536px).
      expect(c.y ?? 0, `${c.name} is in the south hall`).toBeGreaterThan(1400);
    }
    // Clustered on one wall (all within a few tiles vertically).
    const ys = cabinets.map((c) => c.y ?? 0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(16);
  });
});

describe("campus board-game tables (PRD 11 phase 2)", () => {
  interface TiledObject {
    name: string;
    x?: number;
    y?: number;
    properties?: { name: string; value: unknown }[];
  }
  interface ObjectLayer {
    name: string;
    objects?: TiledObject[];
  }
  function objects(layerName: string): TiledObject[] {
    const json = loadMap("campus") as unknown as { layers: ObjectLayer[] };
    return json.layers.find((l) => l.name === layerName)?.objects ?? [];
  }
  function prop(o: TiledObject, name: string): unknown {
    return o.properties?.find((p) => p.name === name)?.value;
  }

  // Must match @metaverse/shared BOARD_TABLES exactly.
  const EXPECTED: Record<string, string> = { "ttt-1": "tictactoe", "c4-1": "connect4" };

  it("authors exactly two opposite seats per table with matching game + label", () => {
    const seats = objects("board_seats");
    expect(seats).toHaveLength(Object.keys(EXPECTED).length * 2);

    for (const [tableId, game] of Object.entries(EXPECTED)) {
      const tableSeats = seats.filter((o) => prop(o, "tableId") === tableId);
      expect(tableSeats, `table ${tableId}`).toHaveLength(2);
      // Distinct seat indices 0 and 1.
      expect(new Set(tableSeats.map((o) => prop(o, "seat")))).toEqual(new Set([0, 1]));
      for (const o of tableSeats) {
        expect(prop(o, "game")).toBe(game);
        expect(String(prop(o, "label")).length).toBeGreaterThan(0);
        expect(["left", "right", "up", "down"]).toContain(prop(o, "facing"));
      }
      // Opposite seats: aligned on one axis, separated on the other.
      const [a, b] = tableSeats;
      const sameRow = (a?.y ?? 0) === (b?.y ?? 0);
      const sameCol = (a?.x ?? 0) === (b?.x ?? 0);
      expect(sameRow !== sameCol).toBe(true);
    }
  });

  it("places a solid table sprite between each table's seats", () => {
    const furniture = objects("furniture");
    const seats = objects("board_seats");
    for (const tableId of Object.keys(EXPECTED)) {
      const tableSeats = seats.filter((o) => prop(o, "tableId") === tableId);
      const midX = tableSeats.reduce((a, o) => a + (o.x ?? 0), 0) / tableSeats.length;
      const midY = tableSeats.reduce((a, o) => a + (o.y ?? 0), 0) / tableSeats.length;
      const table = furniture.find(
        (o) =>
          o.name.startsWith("f_table") &&
          prop(o, "solid") === true &&
          Math.abs((o.x ?? 0) - (midX + 8)) <= 16 &&
          Math.abs((o.y ?? 0) - (midY + 8)) <= 16,
      );
      expect(table, `missing solid table sprite for ${tableId}`).toBeDefined();
    }
  });

  it("relocates both board tables into the Game Arcade hall (PRD 22)", () => {
    // Arcade hall interior: cols 68-86, rows 95-107 → px x 1088-1392, y 1520-1728.
    const seats = objects("board_seats");
    expect(seats).toHaveLength(4);
    for (const s of seats) {
      expect(s.x ?? 0, `${s.name} inside arcade x`).toBeGreaterThan(1088);
      expect(s.x ?? 0, `${s.name} inside arcade x`).toBeLessThan(1392);
      expect(s.y ?? 0, `${s.name} inside arcade y`).toBeGreaterThan(1520);
      expect(s.y ?? 0, `${s.name} inside arcade y`).toBeLessThan(1728);
    }
  });
});

describe("campus wayfinding signage (PRD 22)", () => {
  interface TiledObject {
    name: string;
    x?: number;
    y?: number;
    properties?: { name: string; value: unknown }[];
  }
  function signs(): TiledObject[] {
    const json = loadMap("campus") as unknown as {
      layers: { name: string; objects?: TiledObject[] }[];
    };
    return json.layers.find((l) => l.name === "signs")?.objects ?? [];
  }
  function prop(o: TiledObject, name: string): unknown {
    return o.properties?.find((p) => p.name === name)?.value;
  }

  it("authors a signs object layer", () => {
    expect(signs().length).toBeGreaterThan(0);
  });

  it("every sign carries a non-empty text and a known variant sprite", () => {
    for (const s of signs()) {
      expect(String(prop(s, "text")).length, `${s.name} text`).toBeGreaterThan(0);
      expect(["banner", "post"], `${s.name} variant`).toContain(prop(s, "variant"));
    }
  });

  it("names each building with its AREA_NAMES label", () => {
    const texts = signs().map((s) => String(prop(s, "text")));
    for (const area of AREA_NAMES) {
      expect(texts, `banner for ${area.name}`).toContain(area.name);
    }
  });

  it("includes a Board Games corner sign inside the arcade", () => {
    const boardSign = signs().find((s) => String(prop(s, "text")) === "Board Games");
    expect(boardSign).toBeDefined();
    // In the arcade hall interior (px x 1088-1392, y 1520-1728).
    expect(boardSign?.x ?? 0).toBeGreaterThan(1088);
    expect(boardSign?.y ?? 0).toBeGreaterThan(1520);
  });
});

// Regression guard for the audio-zone bug: a room whose `roomBounds` rect does
// not fully cover its walkable interior classifies a player standing on the
// uncovered floor as OUTDOOR while a teammate a step away is in the room zone —
// the two then can't hear each other. Flood-fill each room's walkable interior
// (bounded by the walls collision layer and the door threshold) and assert every
// reachable tile — sampled at the player's feet, matching WorldScene — resolves
// to that room's own audio zone.
describe("campus room audio zones cover the walkable interior", () => {
  // WorldScene samples the audio zone at the sprite's feet (`y + 8`); mirror it
  // so this guard classifies exactly what the running game does.
  const FEET_OFFSET_Y = 8;

  interface RawTiledObject extends TiledObjectLike {
    name?: string;
  }
  interface RawMap {
    width: number;
    height: number;
    tilewidth: number;
    tileheight: number;
    layers: {
      name: string;
      type: string;
      data?: number[];
      objects?: RawTiledObject[];
    }[];
  }

  const map = loadMap("campus") as unknown as RawMap;
  const { width: W, height: H, tilewidth: TW, tileheight: TH } = map;
  const layer = (name: string) => map.layers.find((l) => l.name === name);
  const objects = (name: string): RawTiledObject[] => layer(name)?.objects ?? [];

  const wallData = layer("walls")?.data;
  if (!wallData) throw new Error("campus walls layer missing");
  const solid = (tx: number, ty: number): boolean => {
    if (tx < 0 || tx >= W || ty < 0 || ty >= H) return true;
    return (wallData[ty * W + tx] ?? 0) !== 0;
  };

  const zones = roomAreasFromObjects(objects("roomBounds"));

  // Door-threshold tiles: the one authored gap in a room's wall ring. Treated as
  // a flood barrier so the fill stays inside the room instead of leaking out the
  // door into the outdoor plaza (the door threshold itself is the intended
  // binary cutover to OUTDOOR and is not part of the room interior).
  const doorTiles = new Set<string>();
  for (const d of objects("doorZones")) {
    const x0 = Math.floor((d.x ?? 0) / TW);
    const y0 = Math.floor((d.y ?? 0) / TH);
    const x1 = Math.floor(((d.x ?? 0) + (d.width ?? 0)) / TW);
    const y1 = Math.floor(((d.y ?? 0) + (d.height ?? 0)) / TH);
    for (let tx = x0; tx < x1; tx++) for (let ty = y0; ty < y1; ty++) doorTiles.add(`${tx},${ty}`);
  }

  // Seed each room's flood-fill from its authored seats (guaranteed interior).
  const seatSeeds = new Map<string, [number, number][]>();
  for (const s of objects("seats")) {
    const roomId = (s.name ?? "").split("_seat_")[0]?.replace("room_", "") ?? "";
    const tx = Math.floor(((s.x ?? 0) + (s.width ?? 0) / 2) / TW);
    const ty = Math.floor(((s.y ?? 0) + (s.height ?? 0) / 2) / TH);
    const seeds = seatSeeds.get(roomId) ?? [];
    seeds.push([tx, ty]);
    seatSeeds.set(roomId, seeds);
  }

  it("has at least one room and a seed for each", () => {
    expect(zones.length).toBeGreaterThan(0);
    for (const z of zones) expect(seatSeeds.get(z.roomId)?.length ?? 0).toBeGreaterThan(0);
  });

  for (const z of zones) {
    it(`room ${z.roomId}: every interior tile resolves to its own zone`, () => {
      const seeds = seatSeeds.get(z.roomId) ?? [];
      const seen = new Set<string>(seeds.map(([x, y]) => `${x},${y}`));
      const queue: [number, number][] = [...seeds];
      let interiorTiles = 0;
      for (let cursor = queue.shift(); cursor !== undefined; cursor = queue.shift()) {
        const [tx, ty] = cursor;
        if (solid(tx, ty) || doorTiles.has(`${tx},${ty}`)) continue;
        interiorTiles++;
        // Sample at the feet point, exactly as WorldScene stamps the zone.
        const px = tx * TW + TW / 2;
        const py = ty * TH + TH / 2 + FEET_OFFSET_Y;
        expect(
          zoneAt(zones, px, py),
          `room ${z.roomId} interior tile (${tx},${ty}) is misclassified`,
        ).toBe(z.roomId);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const key = `${tx + dx},${ty + dy}`;
          if (!seen.has(key)) {
            seen.add(key);
            queue.push([tx + dx, ty + dy]);
          }
        }
      }
      expect(interiorTiles).toBeGreaterThan(0);
    });
  }
});

// The HUD maps (PRD 20) emit room footprints straight from the authored
// roomBounds layer and label hostels by grouping those ids through AREA_NAMES —
// so every room id AREA_NAMES references must exist as a roomBounds rect, or a
// hostel label would silently vanish from the map.
describe("campus roomBounds ids line up with AREA_NAMES (PRD 20 map labels)", () => {
  it("every AREA_NAMES member room has an authored roomBounds rect", () => {
    const json = loadMap("campus") as unknown as {
      layers: {
        name: string;
        objects?: { properties?: { name: string; value: unknown }[] }[];
      }[];
    };
    const authored = new Set(
      (json.layers.find((l) => l.name === "roomBounds")?.objects ?? []).map(
        (o) => o.properties?.find((p) => p.name === "roomId")?.value,
      ),
    );
    for (const area of AREA_NAMES) {
      for (const roomId of area.rooms ?? []) {
        expect(authored, `area ${area.id} references room ${roomId}`).toContain(roomId);
      }
    }
  });
});
