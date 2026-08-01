import { describe, expect, it } from "vitest";
import {
  buildPresenterSeat,
  canPresenterSit,
  parsePresenterFacing,
  presenterSit,
  presenterStandFrom,
} from "./presenterSeat";

const rect = { x: 0, y: 0, width: 16, height: 16, centerX: 8, centerY: 8 };

describe("parsePresenterFacing", () => {
  it("accepts the four cardinals and falls back to down", () => {
    expect(parsePresenterFacing("up")).toBe("up");
    expect(parsePresenterFacing("left")).toBe("left");
    expect(parsePresenterFacing("sideways")).toBe("down");
    expect(parsePresenterFacing(null)).toBe("down");
  });
});

describe("buildPresenterSeat", () => {
  it("stamps room/seat ids and validated facing", () => {
    expect(buildPresenterSeat(rect, "right")).toEqual({
      roomId: "stage",
      seatId: 0,
      facing: "right",
      rect,
      cx: 8,
      cy: 8,
    });
  });
});

describe("canPresenterSit", () => {
  const free = {
    hasSeat: true,
    seated: false,
    boardSeated: false,
    presenterSeated: false,
    nearPresenterSeat: true,
  };

  it("allows a free approach", () => {
    expect(canPresenterSit(free)).toBe(true);
  });

  it("blocks every occupied / ineligible transition", () => {
    expect(canPresenterSit({ ...free, hasSeat: false })).toBe(false);
    expect(canPresenterSit({ ...free, seated: true })).toBe(false);
    expect(canPresenterSit({ ...free, boardSeated: true })).toBe(false);
    expect(canPresenterSit({ ...free, presenterSeated: true })).toBe(false);
    expect(canPresenterSit({ ...free, nearPresenterSeat: false })).toBe(false);
  });
});

describe("presenterSit / presenterStandFrom", () => {
  it("sits and stands with pure flag transitions", () => {
    expect(presenterSit()).toEqual({ presenterSeated: true, nearPresenterSeat: false });
    expect(presenterStandFrom(true)).toEqual({ presenterSeated: false });
    expect(presenterStandFrom(false)).toBeNull();
  });
});
