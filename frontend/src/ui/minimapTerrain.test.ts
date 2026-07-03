import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  TERRAIN_COLORS,
  colorForGid,
  terrainFromTiledMap,
  type TiledMapLike,
} from "./minimapTerrain";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = resolve(__dirname, "../../public/assets/maps");

function loadMap(key: string): TiledMapLike {
  return JSON.parse(
    readFileSync(resolve(MAPS_DIR, `${key}.json`), "utf-8")
  ) as TiledMapLike;
}

describe("terrainFromTiledMap", () => {
  it("returns null without a ground layer", () => {
    expect(
      terrainFromTiledMap({ width: 2, height: 2, tilesets: [], layers: [] })
    ).toBeNull();
  });

  it("rasterizes ground and paints walls over it", () => {
    const map: TiledMapLike = {
      width: 2,
      height: 1,
      tilesets: [{ firstgid: 1, name: "floors_walls", tilecount: 162 }],
      layers: [
        { type: "tilelayer", name: "ground", data: [116, 116] },
        { type: "tilelayer", name: "walls", data: [0, 69] },
      ],
    };
    const t = terrainFromTiledMap(map);
    if (!t) throw new Error("expected terrain");
    expect(t.cols).toBe(2);
    expect(t.rows).toBe(1);
    expect(t.colors[0]).toBe(TERRAIN_COLORS[116]);
    expect(t.colors[1]).toBe(TERRAIN_COLORS[69]);
  });

  it("leaves empty cells (gid 0 everywhere) as null", () => {
    const t = terrainFromTiledMap({
      width: 1,
      height: 1,
      tilesets: [],
      layers: [{ type: "tilelayer", name: "ground", data: [0] }],
    });
    expect(t?.colors[0]).toBeNull();
  });
});

describe("campus terrain (real map on disk)", () => {
  const campus = loadMap("campus");

  it("every ground/wall GID used by campus has an EXPLICIT palette entry", () => {
    // Guard: regenerating the map with new tiles must extend the minimap
    // palette in the same change, or this fails.
    for (const name of ["ground", "walls"]) {
      const layer = campus.layers.find(
        (l) => l.type === "tilelayer" && l.name === name
      );
      if (!layer?.data) throw new Error(`campus layer ${name} missing`);
      const used = new Set(layer.data.filter((g) => g !== 0));
      for (const gid of used) {
        expect(
          TERRAIN_COLORS[gid],
          `campus ${name} GID ${gid} has no explicit minimap color`
        ).toBeDefined();
      }
    }
  });

  it("produces a full-coverage, visually varied grid (paths ≠ grass ≠ walls)", () => {
    const t = terrainFromTiledMap(campus);
    if (!t) throw new Error("expected campus terrain");
    expect(t.cols).toBe(campus.width);
    expect(t.rows).toBe(campus.height);
    expect(t.colors).toHaveLength(campus.width * campus.height);
    // ground covers the whole campus — no holes in the overview
    expect(t.colors.every((c) => c !== null)).toBe(true);
    // and it is not a monochrome box: several distinct terrain colors
    expect(new Set(t.colors).size).toBeGreaterThanOrEqual(4);
  });
});

describe("colorForGid fallbacks", () => {
  const tilesets = [
    { firstgid: 1, name: "floors_walls", tilecount: 162 },
    { firstgid: 163, name: "exterior", tilecount: 2112 },
  ];

  it("unlisted exterior GIDs fall back to the grass family color", () => {
    expect(colorForGid(500, tilesets)).toBe(colorForGid(600, tilesets));
    expect(colorForGid(500, tilesets)).not.toBe(TERRAIN_COLORS[1946]); // ≠ stone
  });

  it("unlisted floors_walls GIDs fall back to the wood family color", () => {
    expect(colorForGid(20, tilesets)).toBe(colorForGid(30, tilesets));
  });

  it("a GID outside every tileset gets the neutral unknown color", () => {
    const neutral = colorForGid(99999, tilesets);
    expect(neutral).toMatch(/^#/);
    expect(neutral).not.toBe(colorForGid(500, tilesets));
  });

  it("the space map still rasterizes via fallbacks", () => {
    const t = terrainFromTiledMap(loadMap("space"));
    if (!t) throw new Error("expected space terrain");
    expect(t.colors.some((c) => c !== null)).toBe(true);
  });
});
