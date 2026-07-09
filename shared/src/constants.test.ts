import { describe, it, expect } from "vitest";
import {
  AREA_NAMES,
  areaNameForId,
  areaNameForRoom,
  areaIdForRoom,
  roomDisplayName,
  BOARD_TABLES,
  gameForTable,
} from "./constants.js";

/** Every private room the world gates behind a door (seeded ids 1-6). */
const GATED_ROOM_IDS = ["1", "2", "3", "4", "5", "6"] as const;

describe("AREA_NAMES registry", () => {
  it("names the two hostels and the standalone areas", () => {
    expect(AREA_NAMES.map((a) => a.name)).toEqual([
      "Mandakini Hostel",
      "Cauvery Hostel",
      "Stage",
      "Game Arcade",
    ]);
  });

  it("maps every private room 1-6 to its hostel", () => {
    expect(areaNameForRoom("1")).toBe("Mandakini Hostel");
    expect(areaNameForRoom("3")).toBe("Mandakini Hostel");
    expect(areaNameForRoom("4")).toBe("Cauvery Hostel");
    expect(areaNameForRoom("6")).toBe("Cauvery Hostel");
  });

  it("returns undefined for unknown rooms and ids", () => {
    expect(areaNameForRoom("7")).toBeUndefined();
    expect(areaNameForId("nope")).toBeUndefined();
  });

  it("collapses each room id onto its hostel area id", () => {
    expect(areaIdForRoom("1")).toBe("mandakini");
    expect(areaIdForRoom("3")).toBe("mandakini");
    expect(areaIdForRoom("4")).toBe("cauvery");
    expect(areaIdForRoom("6")).toBe("cauvery");
    expect(areaIdForRoom("7")).toBeUndefined();
  });

  it("resolves a display name by area id", () => {
    expect(areaNameForId("stage")).toBe("Stage");
    expect(areaNameForId("arcade")).toBe("Game Arcade");
  });

  it("builds a full room display name from area + room number", () => {
    expect(roomDisplayName("1")).toBe("Mandakini Hostel · Room 1");
    expect(roomDisplayName("4")).toBe("Cauvery Hostel · Room 4");
    // Total fallback for an id that belongs to no area.
    expect(roomDisplayName("99")).toBe("Room 99");
  });

  it("names every gated room and every board table (no silent unnamed area)", () => {
    for (const id of GATED_ROOM_IDS) {
      expect(areaNameForRoom(id), `room ${id} has a hostel`).toBeDefined();
      expect(roomDisplayName(id)).toContain(`Room ${id}`);
    }
    for (const table of BOARD_TABLES) {
      expect(gameForTable(table.id), `table ${table.id} has a game`).toBeDefined();
    }
  });
});
