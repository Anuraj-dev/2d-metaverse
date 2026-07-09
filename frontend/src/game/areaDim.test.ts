import { describe, expect, it } from "vitest";
import {
  areaDimAt,
  dimBands,
  dimTintColor,
  focusAreaId,
  floorNameHidden,
  type DimArea,
} from "./areaDim";
import type { Rect } from "./zones";

const AREAS: DimArea[] = [
  { id: "1", rect: { x: 100, y: 100, width: 100, height: 100 } },
  { id: "stage", rect: { x: 400, y: 0, width: 200, height: 200 } },
];

describe("areaDimAt", () => {
  it("is inactive outdoors (no containing area)", () => {
    expect(areaDimAt(AREAS, 0, 0)).toEqual({
      active: false,
      areaId: null,
      areaRect: null,
    });
    expect(areaDimAt(AREAS, 300, 300).active).toBe(false);
  });

  it("activates with the containing area's id + rect inside a room", () => {
    const s = areaDimAt(AREAS, 150, 150);
    expect(s.active).toBe(true);
    expect(s.areaId).toBe("1");
    expect(s.areaRect).toEqual({ x: 100, y: 100, width: 100, height: 100 });
  });

  it("activates for the stage interior", () => {
    expect(areaDimAt(AREAS, 500, 100).areaId).toBe("stage");
  });

  it("is inclusive on the area edge (matches rectContains)", () => {
    expect(areaDimAt(AREAS, 100, 100).areaId).toBe("1");
    expect(areaDimAt(AREAS, 200, 200).areaId).toBe("1");
  });

  it("last match wins when areas overlap", () => {
    const overlapping: DimArea[] = [
      { id: "a", rect: { x: 0, y: 0, width: 100, height: 100 } },
      { id: "b", rect: { x: 50, y: 50, width: 100, height: 100 } },
    ];
    expect(areaDimAt(overlapping, 60, 60).areaId).toBe("b");
  });
});

describe("dimBands", () => {
  const map = { w: 1000, h: 800 };
  const totalArea = (bands: Rect[]) =>
    bands.reduce((sum, b) => sum + b.width * b.height, 0);

  it("surrounds an interior rect with four non-overlapping bands", () => {
    const area: Rect = { x: 200, y: 200, width: 200, height: 200 };
    const bands = dimBands(area, map.w, map.h);
    expect(bands).toHaveLength(4);
    // The four bands exactly tile (map area − focus area).
    expect(totalArea(bands)).toBe(map.w * map.h - area.width * area.height);
    // No band overlaps the focus rect.
    for (const b of bands) {
      const overlapX = Math.max(0, Math.min(b.x + b.width, 400) - Math.max(b.x, 200));
      const overlapY = Math.max(0, Math.min(b.y + b.height, 400) - Math.max(b.y, 200));
      expect(overlapX * overlapY).toBe(0);
    }
  });

  it("drops degenerate bands for an area flush against an edge", () => {
    const area: Rect = { x: 0, y: 0, width: 200, height: 200 };
    const bands = dimBands(area, map.w, map.h);
    // No top band, no left band ⇒ only right + bottom remain.
    expect(bands).toHaveLength(2);
    expect(totalArea(bands)).toBe(map.w * map.h - 200 * 200);
  });

  it("clamps an area that pokes past the map bounds", () => {
    const area: Rect = { x: 900, y: 700, width: 400, height: 400 };
    const bands = dimBands(area, map.w, map.h);
    for (const b of bands) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(map.w);
      expect(b.y + b.height).toBeLessThanOrEqual(map.h);
    }
  });
});

describe("focusAreaId", () => {
  it("is null outdoors", () => {
    expect(focusAreaId(null)).toBe(null);
  });

  it("collapses hostel room ids onto their building area", () => {
    expect(focusAreaId("1")).toBe("mandakini");
    expect(focusAreaId("3")).toBe("mandakini");
    expect(focusAreaId("4")).toBe("cauvery");
    expect(focusAreaId("6")).toBe("cauvery");
  });

  it("passes standalone area ids through unchanged", () => {
    expect(focusAreaId("stage")).toBe("stage");
    expect(focusAreaId("arcade")).toBe("arcade");
  });

  it("is null for an id that maps to no named area", () => {
    expect(focusAreaId("99")).toBe(null);
  });
});

describe("floorNameHidden", () => {
  it("hides a floor name only while the player is inside that area", () => {
    // Standing in Mandakini room 2 ⇒ focus "mandakini".
    const focus = focusAreaId("2");
    expect(floorNameHidden("mandakini", focus)).toBe(true);
    expect(floorNameHidden("cauvery", focus)).toBe(false);
    expect(floorNameHidden("arcade", focus)).toBe(false);
  });

  it("shows every floor name outdoors", () => {
    for (const id of ["mandakini", "cauvery", "stage", "arcade"]) {
      expect(floorNameHidden(id, focusAreaId(null))).toBe(false);
    }
  });

  it("hides the arcade name anywhere inside the arcade", () => {
    expect(floorNameHidden("arcade", focusAreaId("arcade"))).toBe(true);
  });
});

describe("dimTintColor", () => {
  it("maps brightness to a neutral grey", () => {
    expect(dimTintColor(1)).toBe(0xffffff);
    expect(dimTintColor(0)).toBe(0x000000);
    expect(dimTintColor(0.75)).toBe(0xbfbfbf);
  });

  it("clamps out-of-range brightness", () => {
    expect(dimTintColor(2)).toBe(0xffffff);
    expect(dimTintColor(-1)).toBe(0x000000);
  });
});
