import { describe, it, expect } from "vitest";
import {
  rectContains,
  inZone,
  findDoor,
  findSeat,
  findRoomArea,
  hasExitedRoom,
  type DoorZone,
  type SeatZone,
  type RoomArea,
} from "./zones";

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe("rectContains", () => {
  const r = rect(100, 200, 40, 30);
  it("is true inside", () => expect(rectContains(r, 120, 215)).toBe(true));
  it("is inclusive at the top-left corner", () => expect(rectContains(r, 100, 200)).toBe(true));
  it("is inclusive at the bottom-right corner", () => expect(rectContains(r, 140, 230)).toBe(true));
  it("is false just outside x", () => expect(rectContains(r, 141, 215)).toBe(false));
  it("is false just outside y", () => expect(rectContains(r, 120, 231)).toBe(false));
  it("is false for a zero-width rect", () => expect(rectContains(rect(0, 0, 0, 10), 0, 5)).toBe(false));
  it("is false for a negative-height rect", () => expect(rectContains(rect(0, 0, 10, -1), 5, 0)).toBe(false));
});

describe("inZone", () => {
  it("is false for a null zone", () => expect(inZone(null, 5, 5)).toBe(false));
  it("delegates to rectContains for a real zone", () => {
    expect(inZone(rect(0, 0, 10, 10), 5, 5)).toBe(true);
    expect(inZone(rect(0, 0, 10, 10), 50, 5)).toBe(false);
  });
});

describe("findDoor", () => {
  const doors: DoorZone[] = [
    { roomId: "A", name: "Alpha", rect: rect(0, 0, 20, 20) },
    { roomId: "B", name: "Bravo", rect: rect(10, 10, 20, 20) },
  ];
  it("returns null outside all doors", () => expect(findDoor(doors, 100, 100)).toBeNull());
  it("returns the containing door", () => expect(findDoor(doors, 2, 2)?.roomId).toBe("A"));
  it("returns the last match when doors overlap", () => expect(findDoor(doors, 15, 15)?.roomId).toBe("B"));
});

describe("findSeat", () => {
  const seats: SeatZone[] = [
    { roomId: "A", seatId: 0, rect: rect(0, 0, 16, 16) },
    { roomId: "B", seatId: 1, rect: rect(50, 50, 16, 16) },
  ];
  it("ignores seats in un-entered rooms", () => {
    expect(findSeat(seats, new Set(), 8, 8)).toBeNull();
    expect(findSeat(seats, new Set(["B"]), 8, 8)).toBeNull();
  });
  it("returns a seat once its room is entered", () => {
    expect(findSeat(seats, new Set(["A"]), 8, 8)?.seatId).toBe(0);
  });
  it("returns null when the point is outside every entered seat", () => {
    expect(findSeat(seats, new Set(["A", "B"]), 200, 200)).toBeNull();
  });
});

describe("findRoomArea", () => {
  const areas: RoomArea[] = [
    { roomId: "A", rect: rect(0, 0, 100, 100) },
    { roomId: "B", rect: rect(50, 50, 100, 100) },
  ];
  it("returns null in public space", () => expect(findRoomArea(areas, 500, 500)).toBeNull());
  it("returns the first containing area on overlap", () => expect(findRoomArea(areas, 60, 60)?.roomId).toBe("A"));
  it("returns the only containing area", () => expect(findRoomArea(areas, 120, 120)?.roomId).toBe("B"));
});

describe("locked-room entry gate invariant", () => {
  // Mirrors space.json room "1": bounds x496-704 y16-192, door zone y192-208,
  // seat near (568,96). The collision gate (WorldScene.keepLockedRoomsClosed)
  // snaps the player back whenever findRoomArea reports the sampled feet point is
  // inside an un-entered room, and findSeat keeps the room's seats undetectable
  // until the room is entered. Both predicates must hold, or a cancelled key
  // prompt would let the player walk in past the doorway and sit.
  const areas: RoomArea[] = [{ roomId: "1", rect: rect(496, 16, 208, 176) }];
  const seats: SeatZone[] = [{ roomId: "1", seatId: 0, rect: rect(560, 88, 16, 16) }];

  it("detects the room area at the doorway threshold so the gate blocks entry", () => {
    // Feet on the south wall line (y=192) are already "inside" (inclusive rects).
    expect(findRoomArea(areas, 592, 192)?.roomId).toBe("1");
  });
  it("keeps the room's seats hidden until the room is entered", () => {
    expect(findSeat(seats, new Set(), 568, 96)).toBeNull();
    expect(findSeat(seats, new Set(["1"]), 568, 96)?.seatId).toBe(0);
  });
  it("treats the door zone just south of the room as public so the player can stand to unlock", () => {
    expect(findRoomArea(areas, 592, 200)).toBeNull();
  });
});

describe("hasExitedRoom", () => {
  const areas: RoomArea[] = [{ roomId: "A", rect: rect(0, 0, 100, 100) }];

  it("is false when no room is current", () => {
    expect(hasExitedRoom(areas, null, 500, 500)).toBe(false);
  });
  it("is false while still inside the current room", () => {
    expect(hasExitedRoom(areas, "A", 50, 50)).toBe(false);
  });
  it("is false on the room boundary (inclusive rects)", () => {
    expect(hasExitedRoom(areas, "A", 100, 100)).toBe(false);
  });
  it("is true once outside the current room", () => {
    expect(hasExitedRoom(areas, "A", 101, 50)).toBe(true);
  });
  it("is false when the current room has no registered area", () => {
    expect(hasExitedRoom(areas, "ghost", 500, 500)).toBe(false);
  });
});
