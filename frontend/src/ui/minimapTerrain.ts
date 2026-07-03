/**
 * Pure terrain rasterization for the minimap: raw Tiled map JSON in, a
 * per-tile color grid out. The minimap then blits this once per world — so the
 * overview reflects the ACTUAL authored world (grass, paths, building floors,
 * walls) instead of a near-empty box (PRD 12 bug #3).
 *
 * Colors are keyed by the GIDs the map generators actually emit
 * (scripts/gen_campus.py). The guard test asserts every ground/wall GID used
 * by the campus map has an explicit entry, so a map regeneration that
 * introduces new tiles must extend this palette in the same change — the two
 * can't silently drift. Unknown GIDs fall back to a per-tileset family color
 * (exterior → grass green, floors_walls → wood tan) so legacy/space maps stay
 * renderable without per-map code.
 *
 * Pure + framework-free (no Phaser, DOM, or net) per the repo convention.
 */

export interface TiledTilesetLike {
  firstgid: number;
  name: string;
  tilecount: number;
}
export interface TiledLayerLike {
  type: string;
  name: string;
  data?: number[] | undefined;
}
export interface TiledMapLike {
  width: number;
  height: number;
  tilesets: TiledTilesetLike[];
  layers: TiledLayerLike[];
}

/** Per-tile colors for the minimap: cols×rows, row-major, null = nothing there. */
export interface TerrainInfo {
  cols: number;
  rows: number;
  colors: (string | null)[];
}

/**
 * Explicit GID → minimap color. Muted versions of the tiles' own art palette,
 * dark-HUD friendly. Ground GIDs come from scripts/gen_campus.py.
 */
export const TERRAIN_COLORS: Readonly<Record<number, string>> = {
  // exterior.png family (firstgid 163) — grass base + tuft/sprout variants
  366: "#41653a",
  269: "#41653a",
  270: "#41653a",
  271: "#41653a",
  1915: "#41653a",
  301: "#4d7141",
  303: "#4d7141",
  // stone plaza/paths: fill + edge/corner trims
  1946: "#7e7f88",
  1912: "#7e7f88",
  1913: "#7e7f88",
  1914: "#7e7f88",
  1945: "#7e7f88",
  1947: "#7e7f88",
  1978: "#7e7f88",
  1979: "#7e7f88",
  1980: "#7e7f88",
  // grass clearings set into the plaza stone
  1948: "#5c7a4a",
  1949: "#5c7a4a",
  1981: "#5c7a4a",
  1982: "#5c7a4a",
  // tree trunks (solid, on the walls layer)
  1021: "#6b4a2f",
  1022: "#6b4a2f",
  1023: "#6b4a2f",
  1024: "#6b4a2f",
  1025: "#6b4a2f",
  1026: "#6b4a2f",
  1027: "#6b4a2f",
  // floors_walls.png family (firstgid 1)
  116: "#a5824f", // indoor light wood plank (HQ)
  48: "#8a6a41", // tan plank (coworking deck)
  92: "#96693f", // herringbone (auditorium)
  39: "#7c8050", // olive checker (meeting-room carpet)
  69: "#67403a", // brick wall
};

/** Fallback family color when a GID has no explicit entry (legacy maps). */
export const FAMILY_FALLBACK: Readonly<Record<string, string>> = {
  exterior: "#41653a",
  floors_walls: "#a5824f",
};

const UNKNOWN = "#5a5f6e";

/** Resolve the owning tileset of a GID (highest firstgid ≤ gid). */
function familyOf(gid: number, tilesets: readonly TiledTilesetLike[]): string | null {
  let best: TiledTilesetLike | null = null;
  for (const ts of tilesets) {
    if (gid >= ts.firstgid && gid < ts.firstgid + ts.tilecount) {
      if (!best || ts.firstgid > best.firstgid) best = ts;
    }
  }
  return best ? best.name : null;
}

/** Color for a single GID: explicit palette → tileset family → neutral. */
export function colorForGid(
  gid: number,
  tilesets: readonly TiledTilesetLike[]
): string {
  const explicit = TERRAIN_COLORS[gid];
  if (explicit) return explicit;
  const family = familyOf(gid, tilesets);
  return (family && FAMILY_FALLBACK[family]) ?? UNKNOWN;
}

function tileLayer(map: TiledMapLike, name: string): number[] | null {
  const layer = map.layers.find((l) => l.type === "tilelayer" && l.name === name);
  return layer?.data ?? null;
}

/**
 * Rasterize a Tiled map into the minimap terrain grid. Walls paint over
 * ground (they're the world's visual outlines); decor layers are ignored —
 * the minimap is an overview, not a repaint.
 */
export function terrainFromTiledMap(map: TiledMapLike): TerrainInfo | null {
  const ground = tileLayer(map, "ground");
  if (!ground) return null;
  const walls = tileLayer(map, "walls");
  const size = map.width * map.height;
  const colors: (string | null)[] = new Array<string | null>(size).fill(null);
  for (let i = 0; i < size; i++) {
    const wallGid = walls?.[i] ?? 0;
    const gid = wallGid !== 0 ? wallGid : (ground[i] ?? 0);
    if (gid !== 0) colors[i] = colorForGid(gid, map.tilesets);
  }
  return { cols: map.width, rows: map.height, colors };
}
