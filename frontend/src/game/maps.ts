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

const CAMPUS_MAP: MapDef = {
  key: "campus",
  tilesets: [
    { key: "floors_walls", file: "floors_walls.png" },
    { key: "exterior", file: "exterior.png" },
  ],
};

export const MAPS: Record<string, MapDef> = {
  campus: CAMPUS_MAP,
};

export const DEFAULT_MAP = "campus";

/** Active map key. Campus is the single canonical world; an unknown `?map=`
 * override falls through to the default (the legacy `space` escape hatch is
 * gone). */
export function activeMapKey(): string {
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search).get("map");
    if (q && MAPS[q]) return q;
  }
  return DEFAULT_MAP;
}

export function activeMap(): MapDef {
  // activeMapKey() only ever returns a key registered in MAPS, but the Record
  // index signature widens the lookup to `| undefined`; CAMPUS_MAP is the
  // guaranteed default, so fall back to it instead of asserting non-null.
  return MAPS[activeMapKey()] ?? CAMPUS_MAP;
}
