import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAPS, DEFAULT_MAP, activeMapKey, activeMap } from "./maps";

const __dirname = dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubSearch(search: string) {
  vi.stubGlobal("window", { location: { search } } as unknown as Window);
}

describe("maps registry", () => {
  it("defaults to the campus map when no override", () => {
    stubSearch("");
    expect(activeMapKey()).toBe(DEFAULT_MAP);
    expect(activeMapKey()).toBe("campus");
    expect(activeMap()).toBe(MAPS.campus);
  });

  it("honors the ?map=space legacy escape hatch", () => {
    stubSearch("?map=space");
    expect(activeMapKey()).toBe("space");
    expect(activeMap()).toBe(MAPS.space);
  });

  it("ignores an unknown map override", () => {
    stubSearch("?map=nope");
    expect(activeMapKey()).toBe(DEFAULT_MAP);
  });

  it("campus references multiple tilesets including the existing one", () => {
    const campus = MAPS.campus;
    if (!campus) throw new Error("campus map is missing from MAPS");
    const keys = campus.tilesets.map((t) => t.key);
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

  it("every JSON tileset name matches a registry key (guards WorldScene addTilesetImage)", () => {
    for (const def of Object.values(MAPS)) {
      const jsonPath = resolve(__dirname, "../../public/assets/maps", `${def.key}.json`);
      const json = JSON.parse(readFileSync(jsonPath, "utf-8")) as {
        tilesets: { name: string }[];
      };
      const registryKeys = new Set(def.tilesets.map((t) => t.key));
      for (const ts of json.tilesets) {
        expect(
          registryKeys.has(ts.name),
          `map "${def.key}": JSON tileset name "${ts.name}" not found in registry keys [${[...registryKeys].join(", ")}]`
        ).toBe(true);
      }
    }
  });
});
