import { describe, expect, it } from "vitest";
import type { GeometryDoor, GeometrySeat } from "@metaverse/shared";
import {
  PROXIMITY_TOLERANCE_TILES,
  nearRoomDoor,
  nearSeat,
  pointNearRect,
} from "../src/proximity.js";

// Real campus units: 16px tiles, so one tile of tolerance = 16px of slack.
const TILE = 16;
const TOL = PROXIMITY_TOLERANCE_TILES * TILE;

// A room-4 door opening straight from the geometry manifest (32×16 at 576,176).
const DOOR_4: GeometryDoor = { x: 576, y: 176, width: 32, height: 16, roomId: "4" };
// A room-4 seat tile top-left (single 16×16 tile at 560,96).
const SEAT_4_0: GeometrySeat = { roomId: "4", seatId: 0, x: 560, y: 96, facing: "right" };

describe("pointNearRect — inflate-then-contain", () => {
  const rect = { x: 100, y: 100, width: 40, height: 20 };
  const cases: Array<[string, number, number, number, boolean]> = [
    ["inside the rect", 120, 110, 0, true],
    ["far outside, no pad", 300, 300, 0, false],
    ["on the raw edge, no pad", 140, 120, 0, true],
    ["one px past the raw edge, no pad", 141, 120, 0, false],
    ["within the pad band", 148, 128, 16, true],
    ["exactly on the padded edge", 156, 136, 16, true],
    ["one px past the padded edge (x)", 157, 120, 16, false],
    ["one px past the padded edge (y)", 120, 137, 16, false],
    ["padded on the low side", 84, 84, 16, true],
    ["one px past the low padded edge", 83, 100, 16, false],
  ];
  it.each(cases)("%s", (_label, px, py, pad, expected) => {
    expect(pointNearRect(px, py, rect, pad)).toBe(expected);
  });
});

describe("nearRoomDoor — knock proximity", () => {
  const doors = [DOOR_4];
  const cases: Array<[string, number, number, string, boolean]> = [
    ["inside the doorway", 592, 184, "4", true],
    ["at the padded threshold (top-left)", 560, 160, "4", true],
    ["at the padded threshold (bottom-right)", 624, 208, "4", true],
    ["just beyond the padded threshold (x)", 559, 184, "4", false],
    ["just beyond the padded threshold (y)", 592, 209, "4", false],
    ["across the map", 100, 1700, "4", false],
    ["at the door but querying another room", 592, 184, "5", false],
  ];
  it.each(cases)("%s", (_label, x, y, roomId, expected) => {
    expect(nearRoomDoor({ x, y }, doors, roomId, TOL)).toBe(expected);
  });

  it("is fail-closed when the room has no door geometry", () => {
    expect(nearRoomDoor({ x: 592, y: 184 }, [], "4", TOL)).toBe(false);
  });

  it("matches any of a room's several doors", () => {
    const second: GeometryDoor = { x: 900, y: 176, width: 32, height: 16, roomId: "4" };
    expect(nearRoomDoor({ x: 916, y: 184 }, [DOOR_4, second], "4", TOL)).toBe(true);
  });
});

describe("nearSeat — private-seat proximity", () => {
  // seat tile is 16×16 at (560,96); +16px pad ⇒ x∈[544,592], y∈[80,128].
  const cases: Array<[string, number, number, boolean]> = [
    ["on the seat tile top-left", 560, 96, true],
    ["at the seat tile centre", 568, 104, true],
    ["at the padded threshold (low corner)", 544, 80, true],
    ["at the padded threshold (high corner)", 592, 128, true],
    ["just beyond the padded threshold (x)", 593, 96, false],
    ["just beyond the padded threshold (y)", 560, 129, false],
    ["just short of the low padded edge (x)", 543, 96, false],
    ["across the map", 100, 1700, false],
  ];
  it.each(cases)("%s", (_label, x, y, expected) => {
    expect(nearSeat({ x, y }, SEAT_4_0, TILE, TOL)).toBe(expected);
  });
});
