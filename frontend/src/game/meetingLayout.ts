/**
 * Pure view-model for the meeting grid layout (PRD 23). Plain values in, plain
 * values out — no LiveKit, React, or DOM imports — so every layout decision is
 * table-testable without a media connection (scene-as-glue + pure modules).
 *
 * It owns three decisions the renderer only consumes:
 *  1. Focus resolution — which tile (if any) is the large focus tile: a manually
 *     clicked tile wins; otherwise the most-recent active screen share; otherwise
 *     none (symmetric grid). Two simultaneous shares → the most recent focuses,
 *     the other stays a selectable filmstrip tile (user story 13).
 *  2. Arrangement — focus tile + filmstrip, or a symmetric grid, with rows/columns
 *     derived from the participant count.
 *  3. Aspect-ratio cell math — the largest aspect-preserving cell that fits a
 *     container for a given rows×columns (user story 7).
 */

export type TileSource = "camera" | "screen";

/** One renderable tile the layout reasons about (identity erased to plain data). */
export interface MeetingTile {
  /** Unique, stable tile id — `${participantId}:${source}`. */
  key: string;
  participantId: string;
  source: TileSource;
  self: boolean;
  hasVideo: boolean;
  /**
   * Monotonic arrival counter; larger = added more recently. Drives share
   * precedence (most-recent screen share wins focus) and a stable render order.
   */
  order: number;
}

export interface MeetingLayoutInput {
  tiles: readonly MeetingTile[];
  /** Tile key the user manually focused, or null for automatic focus. */
  manualFocusKey: string | null;
}

export interface GridDims {
  rows: number;
  columns: number;
}

export interface MeetingArrangement {
  mode: "grid" | "focus";
  /** The large tile in focus mode; null in grid mode. */
  focusKey: string | null;
  /** Filmstrip tile keys (focus mode), in stable order; empty in grid mode. */
  filmstrip: readonly string[];
  /** All tile keys (grid mode), in stable order; empty in focus mode. */
  grid: readonly string[];
  /** Grid dimensions in grid mode; `{ rows: 1, columns: filmstrip.length }` in focus mode. */
  dims: GridDims;
}

export interface Size {
  width: number;
  height: number;
}

/** Default meeting tile aspect ratio (16:9). */
export const TILE_ASPECT = 16 / 9;

/** Stable render order: oldest-arriving first, ties broken by key. */
function ordered(tiles: readonly MeetingTile[]): MeetingTile[] {
  return [...tiles].sort((a, b) => a.order - b.order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Resolve which tile should hold the focus slot, or null for a symmetric grid.
 * A present manual focus wins; otherwise the most-recent screen share; otherwise
 * none. A manual focus key that no longer exists is ignored (falls back).
 */
export function resolveFocusKey(input: MeetingLayoutInput): string | null {
  const { tiles, manualFocusKey } = input;
  if (manualFocusKey !== null && tiles.some((t) => t.key === manualFocusKey)) {
    return manualFocusKey;
  }
  let best: MeetingTile | null = null;
  for (const t of tiles) {
    if (t.source !== "screen") continue;
    if (best === null || t.order > best.order) best = t;
  }
  return best === null ? null : best.key;
}

/**
 * Rows/columns for a symmetric grid of `n` tiles: a near-square that grows
 * columns first (2→2×1, 3→2×2, 5→3×2, 9→3×3), matching Meet-style reflow.
 */
export function gridDimensions(n: number): GridDims {
  if (n <= 0) return { rows: 0, columns: 0 };
  const columns = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / columns);
  return { rows, columns };
}

/** Decide the full arrangement from the tiles + manual-focus intent. */
export function arrangeMeeting(input: MeetingLayoutInput): MeetingArrangement {
  const tiles = ordered(input.tiles);
  const focusKey = resolveFocusKey(input);
  if (focusKey === null) {
    const grid = tiles.map((t) => t.key);
    return { mode: "grid", focusKey: null, filmstrip: [], grid, dims: gridDimensions(grid.length) };
  }
  const filmstrip = tiles.filter((t) => t.key !== focusKey).map((t) => t.key);
  return {
    mode: "focus",
    focusKey,
    filmstrip,
    grid: [],
    dims: { rows: 1, columns: Math.max(1, filmstrip.length) },
  };
}

/**
 * Largest aspect-preserving cell (px) that fits `container` for a `rows`×`columns`
 * grid with `gap` px between cells. Returns integer sizes; `{0,0}` when nothing fits.
 */
export function fitCells(
  container: Size,
  dims: GridDims,
  aspect = TILE_ASPECT,
  gap = 0,
): Size {
  const { rows, columns } = dims;
  if (rows <= 0 || columns <= 0 || aspect <= 0) return { width: 0, height: 0 };
  const availW = (container.width - gap * (columns - 1)) / columns;
  const availH = (container.height - gap * (rows - 1)) / rows;
  if (availW <= 0 || availH <= 0) return { width: 0, height: 0 };
  let width = availW;
  let height = width / aspect;
  if (height > availH) {
    height = availH;
    width = height * aspect;
  }
  return { width: Math.floor(width), height: Math.floor(height) };
}
