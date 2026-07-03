import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAPS, DEFAULT_MAP, activeMapKey, activeMap } from "./maps";

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

  it("honors the ?map=space legacy escape hatch", () => {
    stubSearch("?map=space");
    expect(activeMapKey()).toBe("space");
    expect(activeMap()).toBe(MAPS.space);
  });

  it("ignores an unknown map override", () => {
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
