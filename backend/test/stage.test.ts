import { describe, expect, it } from "vitest";
import { canPublishFromStage, isInStageZone } from "../src/stage.js";
import { loadGeometryManifest } from "../src/geometry.js";

// The publish gate reads the generated geometry manifest's stage zones (not a
// hand-mirrored copy), so the thresholds are asserted against the real,
// committed manifest — the same source the production gate consumes.
const zones = loadGeometryManifest().stageZones;
const stage = zones.find((z) => z.zoneType === "stage");
const presenter = zones.find((z) => z.zoneType === "presenter");
if (!stage || !presenter) throw new Error("manifest missing stage/presenter zones");

const center = (r: { x: number; y: number; width: number; height: number }) => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

describe("canPublishFromStage", () => {
  it("accepts a point at the centre of the stage floor", () => {
    const c = center(stage);
    expect(canPublishFromStage(zones, c.x, c.y)).toBe(true);
  });

  it("accepts a point at the centre of the presenter podium", () => {
    const c = center(presenter);
    expect(canPublishFromStage(zones, c.x, c.y)).toBe(true);
  });

  it("accepts the inclusive corners of the stage floor", () => {
    expect(canPublishFromStage(zones, stage.x, stage.y)).toBe(true);
    expect(canPublishFromStage(zones, stage.x + stage.width, stage.y + stage.height)).toBe(true);
  });

  it("rejects the spawn point and other off-stage positions", () => {
    expect(canPublishFromStage(zones, 960, 704)).toBe(false); // campus spawn
    expect(canPublishFromStage(zones, 0, 0)).toBe(false);
    expect(canPublishFromStage(zones, stage.x - 1, center(stage).y)).toBe(false);
    expect(canPublishFromStage(zones, center(stage).x, stage.y + stage.height + 1)).toBe(false);
  });

  it("denies publish when no zones are configured", () => {
    expect(canPublishFromStage([], center(stage).x, center(stage).y)).toBe(false);
  });

  it("isInStageZone agrees with canPublishFromStage", () => {
    const c = center(presenter);
    expect(isInStageZone(zones, c.x, c.y)).toBe(true);
    expect(isInStageZone(zones, 0, 0)).toBe(false);
  });
});
