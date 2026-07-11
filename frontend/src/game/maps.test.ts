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

describe("campus ground plausibility (PRD 25.32)", () => {
  // Stone/path family (exterior.png) — the cracked-stone plaza fill, its
  // edge/corner trims, and the inverse grass-clearing patches. See
  // gen_campus.py STONE / ST_* / CLR_* constants.
  const STONE_FAMILY = new Set([
    1946, 1912, 1913, 1914, 1945, 1947, 1978, 1979, 1980, 1948, 1949, 1981, 1982,
  ]);
  // Every tile a tree block paints across its three layers (canopy → decor_above,
  // trunk → walls, shadow → ground_decor). See gen_campus.py TREE_SMALL/TREE_BIG.
  const TREE_GIDS = new Set([
    955, 956, 957, 988, 989, 990, 1021, 1022, 1023, 1054, 1055, 1056, 958, 959, 960,
    961, 991, 992, 993, 994, 1024, 1025, 1026, 1027, 1057, 1058, 1059, 1060,
  ]);

  function layerData(json: TiledMap, name: string): number[] {
    const layer = json.layers.find((l) => l.name === name);
    if (!layer?.data) throw new Error(`campus ${name} layer missing`);
    return layer.data;
  }

  // Trees must not grow from concrete: no canopy/trunk/shadow tile may sit over a
  // stone/path ground tile. The generator clears each tree footprint back to grass
  // before the ground detail passes (gen_campus.py "Tree ground clearing" step).
  it("no tree tile grows from a concrete/path ground tile", () => {
    const json = loadMap("campus");
    const ground = layerData(json, "ground");
    const treeLayers = ["decor_above", "walls", "ground_decor"].map((n) =>
      layerData(json, n)
    );
    const offenders: string[] = [];
    for (let i = 0; i < ground.length; i++) {
      if (!STONE_FAMILY.has(ground[i] ?? 0)) continue;
      for (const data of treeLayers) {
        if (TREE_GIDS.has(data[i] ?? 0)) {
          offenders.push(`tile ${i}: ground ${ground[i]} under tree ${data[i]}`);
          break;
        }
      }
    }
    expect(offenders, `tree-on-concrete defects: ${offenders.join("; ")}`).toHaveLength(0);
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

  const ARCADE_GAMES = new Set(["snake", "flappy"]);

  it("places exactly two arcade interactables, each with a valid game id + label", () => {
    const arcades = objects("interactables").filter((o) => prop(o, "interactType") === "arcade");
    expect(arcades).toHaveLength(2);
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

  it("relocates the cabinets together into the southern hall (well clear of the plaza)", () => {
    const cabinets = objects("furniture").filter((o) => o.name.startsWith("f_arcade_"));
    expect(cabinets.length).toBe(2);
    for (const c of cabinets) {
      // Deep south of spawn (row 44 = 704px) — the cabinets moved out of the
      // old plaza cluster (~row 50) into the far-south hall (row 96 = 1536px).
      expect(c.y ?? 0, `${c.name} is in the south hall`).toBeGreaterThan(1400);
    }
    // Clustered on one wall (all within a few tiles vertically).
    const ys = cabinets.map((c) => c.y ?? 0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(16);
  });

  // PRD 24.1: the area-focus dim + HUD map read the arcade area from an authored
  // `arcade_zone` (stage layer) that spans the WHOLE interior — cabinet hall AND
  // the board-table corner. The old cabinet-bbox rect only covered the upper
  // hall, leaving the board corner dark. Guard: the zone must enclose the full
  // interior, cabinets, and all four board seats.
  it("authors an arcade_zone spanning the full hall interior (cabinets + board corner)", () => {
    const zone = objects("stage").find((o) => prop(o, "zoneType") === "arcade");
    expect(zone, "arcade_zone in the stage layer").toBeDefined();
    const zx = zone?.x ?? 0;
    const zy = zone?.y ?? 0;
    const zx1 = zx + (zone?.width ?? 0);
    const zy1 = zy + (zone?.height ?? 0);
    // Interior of the hall (cols 68-86, rows 95-107 → px 1088-1392, 1520-1728).
    expect(zx).toBe(1088);
    expect(zy).toBe(1520);
    expect(zx1).toBe(1392);
    expect(zy1).toBe(1728);
    const encloses = (o: TiledObject) =>
      (o.x ?? 0) >= zx && (o.x ?? 0) <= zx1 && (o.y ?? 0) >= zy && (o.y ?? 0) <= zy1;
    for (const c of objects("furniture").filter((o) => o.name.startsWith("f_arcade_"))) {
      expect(encloses(c), `${c.name} inside arcade_zone`).toBe(true);
    }
    const boardSeats = objects("board_seats");
    expect(boardSeats.length).toBeGreaterThan(0);
    for (const s of boardSeats) {
      expect(encloses(s), `${s.name} inside arcade_zone`).toBe(true);
    }
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

describe("campus wayfinding signage (PRD 24, zep-style)", () => {
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
  // The runtime label a sign resolves to: an `area` id via AREA_NAMES, else the
  // literal `text` fallback (mirrors WorldScene.buildSigns).
  function label(o: TiledObject): string {
    const area = prop(o, "area");
    if (typeof area === "string") {
      const named = AREA_NAMES.find((a) => a.id === area);
      if (named) return named.name;
    }
    const text = prop(o, "text");
    return typeof text === "string" ? text : "";
  }

  it("authors a signs object layer", () => {
    expect(signs().length).toBeGreaterThan(0);
  });

  it("every sign is a groundLabel or a floorName and resolves to a non-empty label", () => {
    for (const s of signs()) {
      expect(["groundLabel", "floorName"], `${s.name} kind`).toContain(prop(s, "kind"));
      expect(label(s).length, `${s.name} label`).toBeGreaterThan(0);
    }
  });

  it("has NO plaques (removed in PRD 24.1 — they occluded avatars)", () => {
    expect(signs().some((s) => prop(s, "kind") === "plaque")).toBe(false);
  });

  it("every groundLabel carries a known arrow direction", () => {
    const grounds = signs().filter((s) => prop(s, "kind") === "groundLabel");
    expect(grounds.length).toBeGreaterThan(0);
    for (const s of grounds) {
      expect(["up", "down", "left", "right"], `${s.name} dir`).toContain(prop(s, "dir"));
    }
  });

  it("paints a floor name for every named building area", () => {
    const floorAreas = signs()
      .filter((s) => prop(s, "kind") === "floorName")
      .map((s) => prop(s, "area"));
    for (const area of AREA_NAMES) {
      expect(floorAreas, `floor name for ${area.name}`).toContain(area.id);
    }
  });

  it("points a plaza ground label toward every away area, including Mandakini", () => {
    const grounds = signs().filter(
      (s) => prop(s, "kind") === "groundLabel" && (s.name ?? "").startsWith("ground_plaza_"),
    );
    const areas = grounds.map((s) => prop(s, "area"));
    expect(areas).toContain("mandakini");
    expect(areas).toContain("cauvery");
    expect(areas).toContain("stage");
    expect(areas).toContain("arcade");
  });

  it("places the arcade floor name inside the arcade hall interior", () => {
    // Arcade hall interior: px x 1088-1392, y 1520-1728.
    const arcadeFloor = signs().find(
      (s) => prop(s, "kind") === "floorName" && prop(s, "area") === "arcade",
    );
    expect(arcadeFloor).toBeDefined();
    expect(arcadeFloor?.x ?? 0).toBeGreaterThan(1088);
    expect(arcadeFloor?.x ?? 0).toBeLessThan(1392);
    expect(arcadeFloor?.y ?? 0).toBeGreaterThan(1520);
    expect(arcadeFloor?.y ?? 0).toBeLessThan(1728);
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

// PRD 25.33 furniture plausibility: solid furniture must never block a door, a
// seat, an interaction prompt, a main walkable artery, or another solid piece,
// and the flagged desk/cafe clutter must stay thinned. Footprints are derived
// from the authored generator data + the on-disk sprite sizes, mirroring the
// collision body WorldScene.addSolid builds (80% width × 55% height, bottom-
// anchored) — the same source of truth the E2E walkability suite exercises.
describe("campus furniture plausibility (PRD 25.33)", () => {
  const FURN_DIR = resolve(__dirname, "../../public/assets/furniture");

  interface FurnObject {
    name: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    properties?: { name: string; value: unknown }[];
  }
  const json = loadMap("campus") as unknown as {
    tilewidth: number;
    width: number;
    layers: { name: string; type: string; data?: number[]; objects?: FurnObject[] }[];
  };
  const TS = json.tilewidth;
  const objects = (name: string): FurnObject[] =>
    json.layers.find((l) => l.name === name)?.objects ?? [];
  const prop = (o: FurnObject, name: string): unknown =>
    o.properties?.find((p) => p.name === name)?.value;

  // Stone/path family — an artery hit only counts on actual paving (excludes
  // e.g. the arcade hall's tan-plank aisle, which shares the x=79-80 column but
  // is indoor floor, not a walkable outdoor artery).
  const STONE_FAMILY = new Set([
    1946, 1912, 1913, 1914, 1945, 1947, 1978, 1979, 1980, 1948, 1949, 1981, 1982,
  ]);
  const ground = (() => {
    const l = json.layers.find((x) => x.name === "ground");
    if (!l?.data) throw new Error("campus ground layer missing");
    return l.data;
  })();

  const furnSize = (key: string): { width: number; height: number } => {
    const base = key.startsWith("f_") ? key.slice(2) : key;
    return pngSize(resolve(FURN_DIR, `${base}.png`));
  };

  // Tiles a solid furniture sprite's collision body covers (mirror of
  // WorldScene.addSolid). Keep in lockstep with the scene or this guard measures
  // the wrong footprint.
  const bodyTiles = (o: FurnObject): [number, number][] => {
    const { width: w, height: h } = furnSize(String(prop(o, "key")));
    const cx = o.x ?? 0;
    const cy = o.y ?? 0;
    const bw = w * 0.8;
    const bh = h * 0.55;
    const x0 = cx - bw / 2;
    const x1 = cx + bw / 2;
    const y1 = cy + h / 2;
    const y0 = y1 - bh;
    const tiles: [number, number][] = [];
    for (let tx = Math.floor(x0 / TS); tx <= Math.floor((x1 - 0.01) / TS); tx++) {
      for (let ty = Math.floor(y0 / TS); ty <= Math.floor((y1 - 0.01) / TS); ty++) {
        tiles.push([tx, ty]);
      }
    }
    return tiles;
  };

  const rectTiles = (o: FurnObject): string[] => {
    const out: string[] = [];
    const x0 = Math.floor((o.x ?? 0) / TS);
    const y0 = Math.floor((o.y ?? 0) / TS);
    const x1 = Math.floor(((o.x ?? 0) + (o.width ?? 0)) / TS);
    const y1 = Math.floor(((o.y ?? 0) + (o.height ?? 0)) / TS);
    for (let tx = x0; tx < x1; tx++) for (let ty = y0; ty < y1; ty++) out.push(`${tx},${ty}`);
    return out;
  };
  const pointTile = (o: FurnObject): string =>
    `${Math.floor(((o.x ?? 0) + (o.width ?? 0) / 2) / TS)},` +
    `${Math.floor(((o.y ?? 0) + (o.height ?? 0) / 2) / TS)}`;

  const solids = objects("furniture").filter((o) => prop(o, "solid") === true);

  it("has solid furniture to check (guards a silent empty run)", () => {
    expect(solids.length).toBeGreaterThan(0);
  });

  it("no solid furniture body sits on a door threshold", () => {
    const doors = new Set<string>();
    for (const d of objects("doorZones")) for (const t of rectTiles(d)) doors.add(t);
    const bad: string[] = [];
    for (const o of solids)
      for (const [tx, ty] of bodyTiles(o))
        if (doors.has(`${tx},${ty}`)) bad.push(`${o.name}@(${tx},${ty})`);
    expect(bad, `furniture on a door: ${bad.join(", ")}`).toHaveLength(0);
  });

  it("no solid furniture body sits on a seat or board-seat tile", () => {
    const seats = new Set<string>();
    for (const s of [...objects("seats"), ...objects("board_seats")]) seats.add(pointTile(s));
    const bad: string[] = [];
    for (const o of solids)
      for (const [tx, ty] of bodyTiles(o))
        if (seats.has(`${tx},${ty}`)) bad.push(`${o.name}@(${tx},${ty})`);
    expect(bad, `furniture on a seat: ${bad.join(", ")}`).toHaveLength(0);
  });

  // Arcade cabinets deliberately cap the top rows of their own arcade zone (the
  // zone extends south for a collision-free approach strip — see the arcade-hall
  // suite); every other prompt (info board, agenda whiteboard, portal) must be
  // walk-up clear. This is the regression that removed the plaza info-board
  // shrub and nudged the HQ welcome desk off the whiteboard.
  it("no solid furniture blocks an info/whiteboard/portal prompt", () => {
    const zones = new Set<string>();
    for (const o of objects("interactables")) {
      const t = prop(o, "interactType");
      if (t === "info" || t === "whiteboard" || t === "portal")
        for (const c of rectTiles(o)) zones.add(c);
    }
    const bad: string[] = [];
    for (const o of solids)
      for (const [tx, ty] of bodyTiles(o))
        if (zones.has(`${tx},${ty}`)) bad.push(`${o.name}@(${tx},${ty})`);
    expect(bad, `furniture on an interactable prompt: ${bad.join(", ")}`).toHaveLength(0);
  });

  it("no two solid furniture bodies overlap", () => {
    const claimed = new Map<string, string>();
    const bad: string[] = [];
    for (const o of solids) {
      for (const [tx, ty] of bodyTiles(o)) {
        const key = `${tx},${ty}`;
        const prev = claimed.get(key);
        if (prev !== undefined && prev !== o.name) bad.push(`${prev} × ${o.name} @(${key})`);
        else claimed.set(key, o.name);
      }
    }
    expect(bad, `overlapping furniture: ${bad.join(", ")}`).toHaveLength(0);
  });

  it("no solid furniture body sits on a main walkable path artery", () => {
    // The authored stone arteries players route down (gen_campus.py "Main path
    // arteries" + hostel spur). A hit counts only on actual paving.
    const onArtery = (tx: number, ty: number): boolean =>
      (ty >= 43 && ty <= 45) || // E-W plaza artery
      (tx >= 56 && tx <= 63) || // N-S HQ↔cafe artery
      tx === 29 ||
      tx === 30 || // park path
      tx === 79 ||
      tx === 80 || // east auditorium↔coworking path
      (tx >= 34 && tx <= 35 && ty >= 46 && ty <= 92); // hostel spur
    const bad: string[] = [];
    for (const o of solids)
      for (const [tx, ty] of bodyTiles(o))
        if (onArtery(tx, ty) && STONE_FAMILY.has(ground[ty * json.width + tx] ?? 0))
          bad.push(`${o.name}@(${tx},${ty})`);
    expect(bad, `furniture on a path artery: ${bad.join(", ")}`).toHaveLength(0);
  });

  it("keeps the flagged desk/cafe clutter thinned", () => {
    const furn = objects("furniture");
    // Cafe round tables (SW terrace) thinned from 18 to 12.
    const cafeTables = furn.filter(
      (o) =>
        o.name === "f_table_small" &&
        (o.x ?? 0) <= 55 * TS &&
        (o.y ?? 0) >= 62 * TS &&
        (o.y ?? 0) <= 80 * TS,
    );
    expect(cafeTables.length).toBeLessThanOrEqual(12);
    // Coworking desks (SE deck) thinned from 13 to 10.
    const coworkDesks = furn.filter(
      (o) => /^f_desk/.test(o.name) && (o.x ?? 0) >= 57 * TS && (o.y ?? 0) >= 62 * TS,
    );
    expect(coworkDesks.length).toBeLessThanOrEqual(10);
  });
});
