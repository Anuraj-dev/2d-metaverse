/**
 * Server geometry manifest: the single, versioned, server-consumable description
 * of the campus's authoritative spatial features — world bounds, walkability
 * (collision), doors, private-room seats, board chairs, stage/presenter zones,
 * and portals.
 *
 * It is GENERATED — never hand-written — by `frontend/scripts/gen_campus.py` from
 * the same authored source that emits `campus.json`, and committed at
 * `backend/assets/campus.geometry.json`. The backend loads it, `safeParse`s it
 * against `geometryManifestSchema`, and refuses readiness on an invalid or
 * version-mismatched manifest (see `backend/src/geometry.ts`).
 *
 * Downstream pilot slices (movement envelope, walkability/collision validation,
 * door/seat/board-seat proximity, stage-authorization hardening) consume THIS
 * shape rather than re-deriving geometry from the tilemap or hand-mirroring it —
 * so every coordinate here is in world PIXELS (tile coordinate × `tile.size`),
 * matching the units the server already validates positions in.
 */
import { z } from "zod";

/** A facing direction, matching `DIRS`. Seats/chairs carry one. */
export const geometryFacingSchema = z.enum(["down", "left", "right", "up"]);

const pixel = z.number().int();
const span = z.number().int().positive();

/** An axis-aligned rectangle in world pixels (top-left origin). */
export const geometryRectSchema = z.object({
  x: pixel,
  y: pixel,
  width: span,
  height: span,
});
export type GeometryRect = z.infer<typeof geometryRectSchema>;

/** A private-room interior boundary (its `roomBounds` rect). */
export const geometryRoomSchema = geometryRectSchema.extend({
  roomId: z.string().min(1),
});

/** A private-room door opening (its `doorZone` rect). */
export const geometryDoorSchema = geometryRectSchema.extend({
  roomId: z.string().min(1),
});

/** A private-room seat (top-left of its tile, in pixels). */
export const geometrySeatSchema = z.object({
  roomId: z.string().min(1),
  seatId: z.number().int().nonnegative(),
  x: pixel,
  y: pixel,
  facing: geometryFacingSchema,
});

/** A board-table chair (public plaza seat feeding a server-authoritative match). */
export const geometryBoardSeatSchema = z.object({
  tableId: z.string().min(1),
  seat: z.number().int().nonnegative(),
  game: z.string().min(1),
  x: pixel,
  y: pixel,
  facing: geometryFacingSchema,
});

/** A stage/presenter broadcast zone (where a performer may go live). */
export const geometryStageZoneSchema = geometryRectSchema.extend({
  name: z.string().min(1),
  zoneType: z.enum(["stage", "presenter"]),
});

/** A portal shortcut: an interact zone plus its teleport target. */
export const geometryPortalSchema = geometryRectSchema.extend({
  id: z.number().int(),
  targetX: pixel,
  targetY: pixel,
});

/** A solid furniture footprint anchor (sprite centre, in pixels). */
export const geometrySolidObjectSchema = z.object({
  key: z.string().min(1),
  x: pixel,
  y: pixel,
});

/**
 * Walkability grid derived from the walls tile layer: a flat row-major array of
 * length `cols * rows`, where `1` marks a blocked (wall or tree-trunk) tile and
 * `0` an open one. Solid furniture (which also blocks movement, but whose pixel
 * footprint depends on sprite size the generator does not know) is carried
 * separately as `solidObjects` for a downstream collision pass to expand.
 */
export const geometryCollisionSchema = z
  .object({
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    blocked: z.array(z.union([z.literal(0), z.literal(1)])),
  })
  .refine((c) => c.blocked.length === c.cols * c.rows, {
    message: "collision.blocked length must equal cols * rows",
  });

/** The complete, versioned server geometry manifest. */
export const geometryManifestSchema = z.object({
  version: z.number().int().positive(),
  tile: z.object({
    size: span,
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
  world: z.object({ width: span, height: span }),
  spawn: z.object({ x: pixel, y: pixel }),
  rooms: z.array(geometryRoomSchema),
  doors: z.array(geometryDoorSchema),
  seats: z.array(geometrySeatSchema),
  boardSeats: z.array(geometryBoardSeatSchema),
  stageZones: z.array(geometryStageZoneSchema),
  portals: z.array(geometryPortalSchema),
  solidObjects: z.array(geometrySolidObjectSchema),
  collision: geometryCollisionSchema,
});

export type GeometryManifest = z.infer<typeof geometryManifestSchema>;
export type GeometryRoom = z.infer<typeof geometryRoomSchema>;
export type GeometryDoor = z.infer<typeof geometryDoorSchema>;
export type GeometrySeat = z.infer<typeof geometrySeatSchema>;
export type GeometryBoardSeat = z.infer<typeof geometryBoardSeatSchema>;
export type GeometryStageZone = z.infer<typeof geometryStageZoneSchema>;
export type GeometryPortal = z.infer<typeof geometryPortalSchema>;
export type GeometrySolidObject = z.infer<typeof geometrySolidObjectSchema>;
export type GeometryCollision = z.infer<typeof geometryCollisionSchema>;
