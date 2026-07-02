/**
 * Zone detection: pure position → containing door / seat / room-area / stage.
 *
 * Extracted from WorldScene.checkZones so map-boundary logic is testable without
 * Phaser. The scene samples the player point, calls these queries each frame, and
 * keeps the diff/emit bookkeeping (only these functions decide *what* contains the
 * point — never what to broadcast).
 *
 * `rectContains` mirrors `Phaser.Geom.Rectangle.Contains`: inclusive on all edges,
 * and false for degenerate (non-positive width/height) rects.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DoorZone {
  roomId: string;
  name: string;
  rect: Rect;
}

export interface SeatZone {
  roomId: string;
  seatId: number;
  rect: Rect;
}

export interface RoomArea {
  roomId: string;
  rect: Rect;
}

/** Inclusive point-in-rect test matching Phaser.Geom.Rectangle.Contains. */
export function rectContains(rect: Rect, px: number, py: number): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  return (
    px >= rect.x &&
    px <= rect.x + rect.width &&
    py >= rect.y &&
    py <= rect.y + rect.height
  );
}

/** True when the point is inside the (optional) zone rect. */
export function inZone(rect: Rect | null, px: number, py: number): boolean {
  return rect ? rectContains(rect, px, py) : false;
}

/**
 * The door zone containing the point, or null. Last match wins if zones overlap
 * (preserves the scene's original forward-scan-last-write behaviour).
 */
export function findDoor<T extends DoorZone>(
  doors: T[],
  px: number,
  py: number
): T | null {
  let found: T | null = null;
  for (const d of doors) if (rectContains(d.rect, px, py)) found = d;
  return found;
}

/**
 * The seat containing the point whose room has already been entered, or null.
 * Seats in un-entered rooms are invisible to detection. Last match wins.
 */
export function findSeat<T extends SeatZone>(
  seats: T[],
  enteredRooms: ReadonlySet<string>,
  px: number,
  py: number
): T | null {
  let found: T | null = null;
  for (const s of seats)
    if (enteredRooms.has(s.roomId) && rectContains(s.rect, px, py)) found = s;
  return found;
}

/** The first room-area whose rect contains the point, or null. */
export function findRoomArea<T extends RoomArea>(
  areas: T[],
  px: number,
  py: number
): T | null {
  for (const a of areas) if (rectContains(a.rect, px, py)) return a;
  return null;
}

/**
 * Room-exit detection: true when the player — previously inside `roomId` — is now
 * outside that room's area. False when no room is current or the room has no
 * registered area (nothing to walk out of).
 */
export function hasExitedRoom(
  areas: RoomArea[],
  roomId: string | null,
  px: number,
  py: number
): boolean {
  if (!roomId) return false;
  const area = areas.find((a) => a.roomId === roomId);
  if (!area) return false;
  return !rectContains(area.rect, px, py);
}
