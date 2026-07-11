/**
 * Authoritative movement envelope (PRD 25.21) — the single, pure decision point
 * for whether a client-reported `move` is physically possible, or an impossible
 * teleport that must be rejected and corrected.
 *
 * Plain values in, plain values out: no Phaser, no net, no Redis, no logger — so
 * every boundary/replay case is unit-testable service-free (see movement.test.ts)
 * and the socket layer stays a thin shell that just feeds it the last-accepted
 * position and the generated geometry manifest.
 *
 * What it checks, in order:
 *  1. Bounds — the proposed position must lie inside the campus world rect
 *     (from the geometry manifest, never hardcoded).
 *  2. Entry re-anchor — the first move after a join or connection recovery is
 *     accepted (bounds permitting) and becomes the new anchor, because a
 *     recovered client may have kept walking while its buffered moves were held.
 *  3. Portal jumps — a teleport declared in the manifest (`portals[]`: an
 *     interact rect + a target) is a LEGAL discontinuity, exempt from the speed
 *     envelope. Validated against the manifest, not trusted from the client.
 *  4. Speed envelope — otherwise the Euclidean delta must fit within a generous
 *     budget derived from the shared MOVEMENT speed constants (sprint speed ×
 *     headroom) integrated over a capped slice of elapsed time, plus a fixed
 *     slack. This is anti-teleport, not anti-lag: it is deliberately loose so
 *     honest sprint, reconnect bursts, and hidden-tab cadence never trip it.
 *
 *  5. Walkability (PRD 25.22) — the proposed position must sit on a walkable
 *     tile: not a wall/tree cell (`manifest.collision.blocked`) and not a solid
 *     furniture footprint (`manifest.solidObjects`). Checked AFTER the portal
 *     exemption (portal targets land on walkable tiles by construction) and
 *     BEFORE the speed envelope, so an in-envelope wall-clip — a small honest-
 *     paced delta that ends inside a wall — is still rejected (the speed check
 *     alone would wave it through). See `createWalkability` for the semantics.
 */
import {
  MOVEMENT,
  type GeometryCollision,
  type GeometryPortal,
  type GeometrySolidObject,
  type MovementRejection,
} from "@metaverse/shared";

/** The last position the server accepted for a player, with the wall-clock ms at
 *  which it was accepted. The envelope integrates elapsed time from `at`. */
export interface MovementAnchor {
  x: number;
  y: number;
  /** `Date.now()` (ms) when this position was accepted. */
  at: number;
}

/** A client-proposed absolute position (already zod-validated for finiteness). */
export interface MovementProposal {
  x: number;
  y: number;
}

/**
 * A precomputed, tile-indexed walkability lookup for the campus. Built once from
 * the geometry manifest (see `createWalkability`) and reused across every move —
 * `isBlockedAtPixel` is O(1) (a `Set` membership test), so validating a move is
 * allocation-free.
 */
export interface Walkability {
  readonly cols: number;
  readonly rows: number;
  readonly tileSize: number;
  /** True when the world-pixel position falls on a blocked (non-walkable) tile. */
  isBlockedAtPixel(x: number, y: number): boolean;
}

/**
 * Derive the authoritative walkability lookup from the manifest's collision grid
 * and solid-furniture anchors — the SAME two inputs the client blocks on.
 *
 * Semantics (matched to how an honest client actually blocks):
 *  - A tile is blocked if `collision.blocked` marks it `1` (a wall or tree-trunk
 *    cell, derived from the `walls` tile layer) …
 *  - … OR it holds the centre anchor of a solid furniture object. The generator
 *    emits only furniture centres (its pixel footprint depends on sprite size it
 *    does not know), so we block the single tile the anchor sits in. That anchor
 *    is always inside the furniture's collision body, so an honest client — whose
 *    feet-box is stopped by that body — can never report its position on that
 *    tile; blocking it is safe, and larger multi-tile footprints are a documented
 *    follow-up rather than a guess made here.
 *
 * The proposed position's OWN tile is what gets tested (not a swept path): the
 * client reports its avatar's anchor point, and its local physics already
 * prevented that point from entering a wall — so an honest report never lands on
 * a blocked tile. This makes doorways/thresholds traversable with no special-
 * casing, because those are authored as non-blocked cells in the manifest.
 */
export function createWalkability(
  collision: GeometryCollision,
  solidObjects: readonly GeometrySolidObject[],
  tileSize: number,
): Walkability {
  const { cols, rows, blocked } = collision;
  const blockedTiles = new Set<number>();
  for (let i = 0; i < blocked.length; i++) {
    if (blocked[i] === 1) blockedTiles.add(i);
  }
  for (const obj of solidObjects) {
    const col = Math.floor(obj.x / tileSize);
    const row = Math.floor(obj.y / tileSize);
    if (col >= 0 && col < cols && row >= 0 && row < rows) {
      blockedTiles.add(row * cols + col);
    }
  }
  return {
    cols,
    rows,
    tileSize,
    isBlockedAtPixel(x: number, y: number): boolean {
      // Clamp the exact far edge (x === world.width) back onto the last tile; a
      // sub-zero/over-max pixel is an out-of-bounds concern handled upstream.
      const col = Math.min(Math.max(Math.floor(x / tileSize), 0), cols - 1);
      const row = Math.min(Math.max(Math.floor(y / tileSize), 0), rows - 1);
      return blockedTiles.has(row * cols + col);
    },
  };
}

/** Everything the validator needs from the world, all from the geometry manifest
 *  except the two per-connection flags. */
export interface MovementContext {
  /** World bounds in world pixels (`manifest.world`). */
  world: { width: number; height: number };
  /** Manifest-declared portals (`manifest.portals`) — the only legal teleports. */
  portals: readonly GeometryPortal[];
  /** Per-tile walkability derived from `manifest.collision` + `solidObjects`. */
  walkable: Walkability;
  /** Tile size (px), used only to size the portal match tolerance. */
  tileSize: number;
  /** The first move after a join/recovery: re-anchor instead of speed-checking. */
  justEntered: boolean;
}

/** Accept (caller advances the anchor to the proposal) or reject (caller keeps
 *  the old anchor and sends an authoritative correction to it). */
export type MovementDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: MovementRejection };

const ACCEPT: MovementDecision = { ok: true };

/** Theoretical max avatar speed in px/ms, with the anti-teleport headroom baked
 *  in. Derived from the shared MOVEMENT constants — never invented here. */
const MAX_SPEED_PX_PER_MS =
  (MOVEMENT.walkSpeedPxPerSec * MOVEMENT.runMultiplier * MOVEMENT.envelopeSpeedMultiplier) / 1000;

/** True when `p` lies within `rect` inflated by `pad` on every side. */
function withinRect(
  px: number,
  py: number,
  rect: { x: number; y: number; width: number; height: number },
  pad: number,
): boolean {
  return (
    px >= rect.x - pad &&
    px <= rect.x + rect.width + pad &&
    py >= rect.y - pad &&
    py <= rect.y + rect.height + pad
  );
}

/**
 * A move is a legal portal jump when the client teleported FROM standing in a
 * declared portal's interact rect TO (near) that portal's target. Both ends are
 * matched against the manifest with a one-tile tolerance to absorb the client's
 * `Math.round`ing and the single walk-frame between the teleport and the next
 * reported position. Since the destination is fixed by the manifest, a hacked
 * client cannot use this to reach an arbitrary coordinate.
 */
function isPortalJump(
  anchor: MovementAnchor,
  proposal: MovementProposal,
  portals: readonly GeometryPortal[],
  tileSize: number,
): boolean {
  for (const portal of portals) {
    const enteredHere = withinRect(anchor.x, anchor.y, portal, tileSize);
    if (!enteredHere) continue;
    const dx = proposal.x - portal.targetX;
    const dy = proposal.y - portal.targetY;
    if (Math.hypot(dx, dy) <= tileSize * 2) return true;
  }
  return false;
}

/**
 * Decide whether `proposal` is an acceptable next position given the player's
 * last-accepted `anchor`, the current time `now` (ms), and world `ctx`.
 */
export function validateMove(
  anchor: MovementAnchor,
  proposal: MovementProposal,
  now: number,
  ctx: MovementContext,
): MovementDecision {
  // 1. Bounds: reject anything outside the campus, whatever produced it.
  if (
    proposal.x < 0 ||
    proposal.y < 0 ||
    proposal.x > ctx.world.width ||
    proposal.y > ctx.world.height
  ) {
    return { ok: false, reason: "out-of-bounds" };
  }

  // 2. Re-anchor the first move after join/recovery (in-bounds already checked).
  if (ctx.justEntered) return ACCEPT;

  // 3. Manifest-declared portal teleports are legal discontinuities (their
  //    targets land on walkable tiles by construction, so they skip both the
  //    walkability and speed checks below).
  if (isPortalJump(anchor, proposal, ctx.portals, ctx.tileSize)) return ACCEPT;

  // 4. Walkability: the proposed position must sit on a walkable tile. Checked
  //    before speed so a small, honest-paced delta that ends inside a wall or on
  //    solid furniture is still rejected (the speed envelope alone would pass it).
  if (ctx.walkable.isBlockedAtPixel(proposal.x, proposal.y)) {
    return { ok: false, reason: "blocked" };
  }

  // 5. Speed envelope: distance must fit a generous, time-integrated budget.
  const elapsedMs = Math.min(Math.max(now - anchor.at, 0), MOVEMENT.envelopeMaxElapsedMs);
  const budget = MAX_SPEED_PX_PER_MS * elapsedMs + MOVEMENT.envelopeSlackPx;
  const distance = Math.hypot(proposal.x - anchor.x, proposal.y - anchor.y);
  if (distance > budget) return { ok: false, reason: "too-fast" };

  return ACCEPT;
}
