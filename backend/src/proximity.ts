/**
 * Pure door/seat proximity decisions (PRD 25.23): is a player's authoritative
 * anchor position close enough to a room's door — or to a private seat — for the
 * server to honour a knock or a sit?
 *
 * Plain values in, plain values out: no Redis, no socket, no logger — so every
 * threshold case is unit-testable service-free (see proximity.test.ts). The
 * socket shell feeds these the server's OWN last-accepted position
 * (`socket.data.moveAnchor`, never a client-supplied coordinate) plus the
 * geometry-manifest rects, and gates the `knock` / `seat-sit` handlers on the
 * boolean result.
 *
 * Tolerance rationale (why honest players are never denied): the client only
 * surfaces the knock/sit prompt when the player's foot-point is INSIDE the
 * door/seat rect — exact rect containment, no padding (frontend `zones.ts`
 * `rectContains`, driving `findDoor`/`findSeat`). The server anchor can trail the
 * visual position by up to one movement throttle tick
 * (`RATE_LIMITS.moveThrottleMs` = 40ms) at sprint speed
 * (`MOVEMENT.walkSpeedPxPerSec * runMultiplier` = 192 px/s ⇒ ~7.7px), plus the
 * client's `Math.round` coordinate jitter. Inflating the rect by one full tile
 * (`PROXIMITY_TOLERANCE_TILES` = 1 ⇒ `tile.size` px) before the containment test
 * covers that lag with >2x headroom, so any position an honest client would sit
 * from is comfortably inside the padded rect. It stays anti-spoof, not anti-lag:
 * a player standing across the map is nowhere near the padded rect.
 */
import type { GeometryDoor, GeometrySeat } from "@metaverse/shared";

/** The server's authoritative last-accepted position for a player, in world px. */
export interface AnchorPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Slack, in tiles, added around a door/seat rect before the containment test.
 * Multiply by the manifest `tile.size` for the pixel tolerance (see rationale
 * above). One tile is generous headroom over the ~7.7px worst-case anchor lag.
 */
export const PROXIMITY_TOLERANCE_TILES = 1;

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * True when (`px`,`py`) lies within `rect` inflated by `pad` px on every side.
 * Inclusive on the padded edges — matches the client's inclusive `rectContains`.
 */
export function pointNearRect(px: number, py: number, rect: Rect, pad: number): boolean {
  return (
    px >= rect.x - pad &&
    px <= rect.x + rect.width + pad &&
    py >= rect.y - pad &&
    py <= rect.y + rect.height + pad
  );
}

/**
 * True when the anchor is within `tolerancePx` of ANY door opening that belongs
 * to `roomId`. A room with no door geometry yields `false` (fail-closed: a knock
 * cannot be proximity-proven, so it must not be honoured).
 */
export function nearRoomDoor(
  anchor: AnchorPoint,
  doors: readonly GeometryDoor[],
  roomId: string,
  tolerancePx: number,
): boolean {
  for (const door of doors) {
    if (door.roomId !== roomId) continue;
    if (pointNearRect(anchor.x, anchor.y, door, tolerancePx)) return true;
  }
  return false;
}

/**
 * True when the anchor is within `tolerancePx` of the given seat's tile (its
 * top-left is `seat.x`,`seat.y`; the tile spans `tileSize` px).
 */
export function nearSeat(
  anchor: AnchorPoint,
  seat: Pick<GeometrySeat, "x" | "y">,
  tileSize: number,
  tolerancePx: number,
): boolean {
  return pointNearRect(
    anchor.x,
    anchor.y,
    { x: seat.x, y: seat.y, width: tileSize, height: tileSize },
    tolerancePx,
  );
}
