import { describe, it, expect } from "vitest";
import { AREA_NAMES, areaNameForId, areaNameForRoom } from "./constants.js";

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

  it("resolves a display name by area id", () => {
    expect(areaNameForId("stage")).toBe("Stage");
    expect(areaNameForId("arcade")).toBe("Game Arcade");
  });
});
