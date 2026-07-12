import { describe, it, expect } from "vitest";
import { GEOMETRY_MANIFEST_VERSION } from "./constants.js";
import {
  geometryManifestSchema,
  geometryCollisionSchema,
  type GeometryManifest,
} from "./geometry.js";

/** A minimal, structurally-valid manifest for targeted schema assertions. */
function validManifest(): GeometryManifest {
  return {
    version: GEOMETRY_MANIFEST_VERSION,
    tile: { size: 16, cols: 2, rows: 2 },
    world: { width: 32, height: 32 },
    spawn: { x: 16, y: 16 },
    rooms: [{ roomId: "1", x: 0, y: 0, width: 16, height: 16 }],
    doors: [{ roomId: "1", x: 0, y: 16, width: 32, height: 16 }],
    seats: [{ roomId: "1", seatId: 0, x: 0, y: 0, facing: "down" }],
    boardSeats: [{ tableId: "ttt-1", seat: 0, game: "tictactoe", x: 0, y: 0, facing: "right" }],
    stageZones: [{ name: "stage_zone", zoneType: "stage", x: 0, y: 0, width: 16, height: 16 }],
    portals: [{ id: 1, x: 0, y: 0, width: 16, height: 16, targetX: 16, targetY: 16 }],
    solidObjects: [{ key: "f_desk", x: 8, y: 8 }],
    collision: { cols: 2, rows: 2, blocked: [1, 0, 0, 1] },
  };
}

describe("geometryManifestSchema", () => {
  it("accepts a well-formed manifest", () => {
    const result = geometryManifestSchema.safeParse(validManifest());
    expect(result.success).toBe(true);
  });

  it("rejects a manifest missing a required top-level section", () => {
    const bad = validManifest() as Partial<GeometryManifest>;
    delete bad.collision;
    expect(geometryManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects non-integer / negative coordinates", () => {
    const bad = validManifest();
    bad.spawn = { x: 16.5, y: 16 };
    expect(geometryManifestSchema.safeParse(bad).success).toBe(false);

    const badSpan = validManifest();
    badSpan.rooms[0]!.width = 0; // spans must be positive
    expect(geometryManifestSchema.safeParse(badSpan).success).toBe(false);
  });

  it("rejects an unknown facing", () => {
    const bad = validManifest();
    (bad.seats[0] as { facing: string }).facing = "sideways";
    expect(geometryManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a stage zone with an unknown zoneType", () => {
    const bad = validManifest();
    (bad.stageZones[0] as { zoneType: string }).zoneType = "arcade";
    expect(geometryManifestSchema.safeParse(bad).success).toBe(false);
  });
});

describe("geometryCollisionSchema length invariant", () => {
  it("accepts a grid whose blocked length equals cols * rows", () => {
    expect(
      geometryCollisionSchema.safeParse({ cols: 3, rows: 2, blocked: [0, 1, 0, 1, 0, 1] }).success,
    ).toBe(true);
  });

  it("rejects a grid whose blocked length is wrong", () => {
    expect(
      geometryCollisionSchema.safeParse({ cols: 3, rows: 2, blocked: [0, 1, 0] }).success,
    ).toBe(false);
  });

  it("rejects blocked cells that are not 0 or 1", () => {
    expect(
      geometryCollisionSchema.safeParse({ cols: 1, rows: 1, blocked: [2] }).success,
    ).toBe(false);
  });
});
