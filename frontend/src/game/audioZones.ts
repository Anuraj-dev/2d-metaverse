/**
 * Zone-aware proximity audio: the pure decision layer for "no voice through
 * walls". World-audio volume between two players is zero unless they share an
 * audio zone; within a zone the existing distance falloff (`proximityVolume`)
 * is unchanged. This COMPOSES with `proximity.ts` — it gates, it does not
 * replace, the falloff math.
 *
 * Zones are derived from the map's room boundary rectangles (the `roomBounds`
 * object layer): each room interior is a named zone whose identity is the
 * existing `roomId`, and everything outside every room is the single outdoor
 * zone (`OUTDOOR_ZONE`). There is no second source of truth — adding a room to
 * the map's `roomBounds` layer auto-creates its audio zone.
 *
 * Doorway behaviour is a deliberate binary cutover at the threshold: a point is
 * either inside a room rect or it is outdoor, with no muffling/attenuation
 * through walls (matching `rectContains`, which is inclusive on every edge).
 *
 * Pure + framework-free (no Phaser, net, or DOM) so every isolation case is a
 * trivial table-driven vitest — same as the other `game/` modules.
 */
import { findRoomArea, type RoomArea } from "./zones";
import { proximityVolume } from "./proximity";

/** The single zone shared by everyone not inside any room rectangle. */
export const OUTDOOR_ZONE = "outdoor";

/**
 * The audio zone containing a point: the id of the first room whose rectangle
 * contains it, or `OUTDOOR_ZONE`. Built on `zones.findRoomArea` so room
 * membership for audio uses the exact same containment rule as door/room-exit
 * detection (no parallel geometry).
 */
export function zoneAt(rooms: readonly RoomArea[], px: number, py: number): string {
  return findRoomArea(rooms as RoomArea[], px, py)?.roomId ?? OUTDOOR_ZONE;
}

/**
 * World-audio volume from one player to another: zero across different zones
 * (the "no voice through walls" rule), otherwise the existing distance falloff
 * within the shared zone. Same-zone behaviour is byte-for-byte the pre-PRD
 * proximity volume, so the outdoor zone is unchanged from today.
 */
export function zoneVolume(
  myZone: string,
  theirZone: string,
  distance: number,
  cutoff?: number
): number {
  if (myZone !== theirZone) return 0;
  return proximityVolume(distance, cutoff);
}

/**
 * A Tiled object as it appears in a map's object layer (the shape shared by the
 * on-disk JSON and Phaser's `TiledObject`). Only the fields zone derivation
 * reads are required.
 */
export interface TiledObjectLike {
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  properties?: { name: string; value: unknown }[] | undefined;
}

/**
 * Derive the audio zones from a map's `roomBounds` object-layer objects: one
 * `RoomArea` per object carrying a `roomId` property. Objects without a usable
 * `roomId` are skipped (nothing to name). This is the single derivation the
 * scene and the tests share, so the runtime zones and the on-disk map data can
 * never drift apart.
 */
export function roomAreasFromObjects(objects: readonly TiledObjectLike[]): RoomArea[] {
  const areas: RoomArea[] = [];
  for (const o of objects) {
    const raw = o.properties?.find((p) => p.name === "roomId")?.value;
    if (raw === undefined || raw === null || raw === "") continue;
    areas.push({
      roomId: String(raw),
      rect: { x: o.x ?? 0, y: o.y ?? 0, width: o.width ?? 0, height: o.height ?? 0 },
    });
  }
  return areas;
}
