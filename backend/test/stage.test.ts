import { describe, expect, it } from "vitest";
import { canPublishFromStage, STAGE_ZONE, PRESENTER_ZONE } from "../src/stage.js";

const center = (r: { x: number; y: number; width: number; height: number }) => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

describe("canPublishFromStage", () => {
  it("accepts a point at the centre of the stage floor", () => {
    const c = center(STAGE_ZONE);
    expect(canPublishFromStage(c.x, c.y)).toBe(true);
  });

  it("accepts a point at the centre of the presenter podium", () => {
    const c = center(PRESENTER_ZONE);
    expect(canPublishFromStage(c.x, c.y)).toBe(true);
  });

  it("accepts the inclusive corners of the stage floor", () => {
    expect(canPublishFromStage(STAGE_ZONE.x, STAGE_ZONE.y)).toBe(true);
    expect(
      canPublishFromStage(STAGE_ZONE.x + STAGE_ZONE.width, STAGE_ZONE.y + STAGE_ZONE.height),
    ).toBe(true);
  });

  it("rejects the spawn point and other off-stage positions", () => {
    expect(canPublishFromStage(960, 704)).toBe(false); // campus spawn
    expect(canPublishFromStage(0, 0)).toBe(false);
    expect(canPublishFromStage(STAGE_ZONE.x - 1, center(STAGE_ZONE).y)).toBe(false);
    expect(
      canPublishFromStage(center(STAGE_ZONE).x, STAGE_ZONE.y + STAGE_ZONE.height + 1),
    ).toBe(false);
  });
});
