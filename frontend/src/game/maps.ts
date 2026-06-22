/**
 * Map registry. Each map declares the tileset images it needs so BootScene can
 * preload them deterministically, and WorldScene can add every tileset to the
 * tilemap (a map may reference more than one tileset).
 *
 * Convention: a tileset's `name` inside the Tiled JSON must equal the image key
 * declared here, so WorldScene can wire them up by name without per-map code.
 */
export interface TilesetRef {
  /** Texture key, must match the tileset `name` in the Tiled JSON. */
  key: string;
  /** File under /assets/tilesets/. */
  file: string;
}

export interface MapDef {
  /** Tilemap cache key + /assets/maps/<key>.json. */
  key: string;
  tilesets: TilesetRef[];
}

export const MAPS: Record<string, MapDef> = {
  space: {
    key: "space",
    tilesets: [{ key: "floors_walls", file: "floors_walls.png" }],
  },
  campus: {
    key: "campus",
    tilesets: [
      { key: "floors_walls", file: "floors_walls.png" },
      { key: "exterior", file: "exterior.png" },
    ],
  },
};

export const DEFAULT_MAP = "space";

/** Active map key, overridable via `?map=campus` for in-progress worlds. */
export function activeMapKey(): string {
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search).get("map");
    if (q && MAPS[q]) return q;
  }
  return DEFAULT_MAP;
}

export function activeMap(): MapDef {
  return MAPS[activeMapKey()];
}
