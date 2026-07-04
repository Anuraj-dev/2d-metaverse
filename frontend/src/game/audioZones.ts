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
 * Baseline audibility floor for two players who share an *enclosed room* zone.
 *
 * A room is one acoustic space: being inside it together must never fall to
 * silence the way open-world proximity does. Without a floor, the open-world
 * distance falloff (`AUDIO_CUTOFF` = 200px) silences same-room teammates once
 * they are more than the cutoff apart — and every campus room's interior is
 * *wider than the cutoff* (the PRD-13 hostel rooms reach a ~280px diagonal), so
 * two players genuinely standing in the same room go mute purely by distance.
 * That is the "sometimes in some rooms I can't hear my teammate" bug: the zone
 * gate promises same-room audibility, but the falloff was quietly zeroing it.
 *
 * The floor guarantees a shared room is always audible while keeping the
 * distance gradient (closer is still louder, up to full volume). The OUTDOOR
 * zone is deliberately *not* floored — the open world keeps its true falloff to
 * zero so you don't hear someone across the plaza.
 */
export const ROOM_AUDIO_FLOOR = 0.35;

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
 * World-audio volume from one player to another:
 *  - zero across different zones (the "no voice through walls" rule);
 *  - within the shared OUTDOOR zone, the open-world distance falloff, unchanged
 *    (can reach 0 — you don't hear someone across the plaza);
 *  - within a shared *room* zone, that same falloff but floored at
 *    `ROOM_AUDIO_FLOOR`, so being in an enclosed room together is always
 *    audible even when the room is wider than the cutoff.
 *
 * The floor keeps the in-room distance gradient (closer stays louder, up to full
 * volume) while restoring the zone model's promise: share a room ⇒ you hear them.
 */
export function zoneVolume(
  myZone: string,
  theirZone: string,
  distance: number,
  cutoff?: number
): number {
  if (myZone !== theirZone) return 0;
  const falloff = proximityVolume(distance, cutoff);
  if (myZone === OUTDOOR_ZONE) return falloff;
  return Math.max(ROOM_AUDIO_FLOOR, falloff);
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
