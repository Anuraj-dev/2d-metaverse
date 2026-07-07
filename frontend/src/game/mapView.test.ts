import { describe, it, expect } from "vitest";
import { areaLabels, nearestDot, type AreaRect, type MapDot } from "./mapView";

describe("areaLabels", () => {
  it("centers labels and resolves names from AREA_NAMES", () => {
    const areas: AreaRect[] = [
      { id: "mandakini", x: 0, y: 0, w: 100, h: 40 },
      { id: "stage", x: 200, y: 100, w: 50, h: 50 },
    ];
    expect(areaLabels(areas)).toEqual([
      { id: "mandakini", name: "Mandakini Hostel", cx: 50, cy: 20 },
      { id: "stage", name: "Stage", cx: 225, cy: 125 },
    ]);
  });

  it("drops rects whose id is not a known area", () => {
    expect(areaLabels([{ id: "mystery", x: 0, y: 0, w: 10, h: 10 }])).toEqual([]);
  });
});

describe("nearestDot", () => {
  const dots: MapDot[] = [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 100, y: 0 },
    { id: "c", x: 10, y: 10 },
  ];

  it("returns the closest dot within radius", () => {
    expect(nearestDot(dots, 2, 2, 20)).toBe("a");
    expect(nearestDot(dots, 98, 1, 20)).toBe("b");
  });

  it("returns null when nothing is within radius", () => {
    expect(nearestDot(dots, 500, 500, 20)).toBeNull();
  });

  it("returns null for an empty dot list", () => {
    expect(nearestDot([], 0, 0, 50)).toBeNull();
  });

  it("prefers the strictly-closer dot", () => {
    expect(nearestDot(dots, 9, 9, 50)).toBe("c");
  });
});
