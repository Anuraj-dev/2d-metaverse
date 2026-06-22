import { afterEach, describe, expect, it, vi } from "vitest";
import { MAPS, DEFAULT_MAP, activeMapKey, activeMap } from "./maps";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubSearch(search: string) {
  vi.stubGlobal("window", { location: { search } } as unknown as Window);
}

describe("maps registry", () => {
  it("defaults to the space map when no override", () => {
    stubSearch("");
    expect(activeMapKey()).toBe(DEFAULT_MAP);
    expect(activeMap()).toBe(MAPS.space);
  });

  it("honors ?map=campus override", () => {
    stubSearch("?map=campus");
    expect(activeMapKey()).toBe("campus");
    expect(activeMap()).toBe(MAPS.campus);
  });

  it("ignores an unknown map override", () => {
    stubSearch("?map=nope");
    expect(activeMapKey()).toBe(DEFAULT_MAP);
  });

  it("campus references multiple tilesets including the existing one", () => {
    const keys = MAPS.campus.tilesets.map((t) => t.key);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(keys).toContain("floors_walls");
    expect(keys).toContain("exterior");
  });

  it("every tileset key maps to a file", () => {
    for (const def of Object.values(MAPS)) {
      for (const ts of def.tilesets) {
        expect(ts.file).toMatch(/\.png$/);
      }
    }
  });
});
