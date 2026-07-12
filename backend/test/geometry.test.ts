import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GEOMETRY_MANIFEST_VERSION } from "@metaverse/shared";
import { afterAll, describe, expect, it } from "vitest";
import {
  getGeometryManifest,
  geometryManifestReady,
  loadGeometryManifest,
  GeometryManifestError,
} from "../src/geometry.js";
import { rooms as seedRooms } from "../src/seed-geometry.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const campusPath = path.resolve(
  here,
  "..",
  "..",
  "frontend",
  "public",
  "assets",
  "maps",
  "campus.json",
);

/** The committed, generated manifest the backend actually ships. */
const manifest = loadGeometryManifest();

/* ---------------- campus.json helpers (recompute the expected manifest) ------ */

interface TiledProp {
  name: string;
  value: unknown;
}
interface TiledObject {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties?: TiledProp[];
}
interface TiledLayer {
  name: string;
  data?: number[];
  objects?: TiledObject[];
}
interface Campus {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
}

const campus = JSON.parse(readFileSync(campusPath, "utf8")) as Campus;
const layer = (name: string): TiledLayer => {
  const found = campus.layers.find((l) => l.name === name);
  if (!found) throw new Error(`campus.json missing layer ${name}`);
  return found;
};
const objects = (name: string): TiledObject[] => layer(name).objects ?? [];
const prop = (o: TiledObject, name: string): unknown =>
  o.properties?.find((p) => p.name === name)?.value;
const rect = (o: TiledObject) => ({ x: o.x, y: o.y, width: o.width, height: o.height });

const tmpFiles: string[] = [];
afterAll(() => {
  for (const f of tmpFiles) rmSync(f, { recursive: true, force: true });
});
function writeTemp(contents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "geom-"));
  const file = path.join(dir, "campus.geometry.json");
  writeFileSync(file, contents);
  tmpFiles.push(dir);
  return file;
}

/* -------------------------------- load / validate --------------------------- */

describe("loadGeometryManifest", () => {
  it("loads and validates the committed manifest at the expected version", () => {
    expect(manifest.version).toBe(GEOMETRY_MANIFEST_VERSION);
    expect(manifest.rooms.length).toBeGreaterThan(0);
    expect(manifest.collision.blocked.length).toBe(
      manifest.collision.cols * manifest.collision.rows,
    );
  });

  it("throws when the file is missing", () => {
    expect(() => loadGeometryManifest("/no/such/campus.geometry.json")).toThrow(
      GeometryManifestError,
    );
  });

  it("throws on malformed JSON", () => {
    const file = writeTemp("{ not json");
    expect(() => loadGeometryManifest(file)).toThrow(/valid JSON/);
  });

  it("throws on a schema violation", () => {
    const broken = { ...manifest, collision: { cols: 2, rows: 2, blocked: [0] } };
    const file = writeTemp(JSON.stringify(broken));
    expect(() => loadGeometryManifest(file)).toThrow(/schema validation/);
  });

  it("throws a clear stale error on a version mismatch", () => {
    const stale = { ...manifest, version: GEOMETRY_MANIFEST_VERSION + 1 };
    const file = writeTemp(JSON.stringify(stale));
    expect(() => loadGeometryManifest(file)).toThrow(/stale geometry manifest/);
  });

  it("reports readiness against the committed manifest", () => {
    expect(geometryManifestReady()).toBe(true);
    expect(getGeometryManifest().version).toBe(GEOMETRY_MANIFEST_VERSION);
  });
});

/* --------------------- consistency: manifest ↔ campus.json ------------------ */

describe("manifest agrees with the frontend campus map", () => {
  it("matches world bounds, tile grid and spawn", () => {
    expect(manifest.tile).toEqual({
      size: campus.tilewidth,
      cols: campus.width,
      rows: campus.height,
    });
    expect(manifest.world).toEqual({
      width: campus.width * campus.tilewidth,
      height: campus.height * campus.tileheight,
    });
    const spawn = objects("spawn")[0]!;
    expect(manifest.spawn).toEqual({ x: spawn.x, y: spawn.y });
  });

  it("matches the walls layer as the walkability grid", () => {
    const walls = layer("walls").data!;
    const expected = walls.map((t) => (t ? 1 : 0));
    expect(manifest.collision.blocked).toEqual(expected);
    expect(manifest.collision.blocked.length).toBe(campus.width * campus.height);
  });

  it("matches every door, room, seat and board seat", () => {
    expect(manifest.doors).toEqual(
      objects("doorZones").map((o) => ({ ...rect(o), roomId: prop(o, "roomId") })),
    );
    expect(manifest.rooms).toEqual(
      objects("roomBounds").map((o) => ({ ...rect(o), roomId: prop(o, "roomId") })),
    );
    expect(manifest.seats).toEqual(
      objects("seats").map((o) => ({
        roomId: prop(o, "roomId"),
        seatId: prop(o, "seatId"),
        x: o.x,
        y: o.y,
        facing: prop(o, "facing"),
      })),
    );
    expect(manifest.boardSeats).toEqual(
      objects("board_seats").map((o) => ({
        tableId: prop(o, "tableId"),
        seat: prop(o, "seat"),
        game: prop(o, "game"),
        x: o.x,
        y: o.y,
        facing: prop(o, "facing"),
      })),
    );
  });

  it("matches the stage/presenter zones and portals", () => {
    expect(manifest.stageZones).toEqual(
      objects("stage")
        .filter((o) => prop(o, "zoneType") === "stage" || prop(o, "zoneType") === "presenter")
        .map((o) => ({ ...rect(o), name: o.name, zoneType: prop(o, "zoneType") })),
    );
    expect(manifest.portals).toEqual(
      objects("interactables")
        .filter((o) => prop(o, "interactType") === "portal")
        .map((o) => ({
          ...rect(o),
          id: o.id,
          targetX: prop(o, "targetX"),
          targetY: prop(o, "targetY"),
        })),
    );
  });
});

/* ------------ cross-check: hand-maintained server geometry ↔ manifest -------- */

describe("manual server geometry mirrors the manifest", () => {
  it("seed door zones equal the manifest doors exactly", () => {
    for (const room of seedRooms) {
      const door = manifest.doors.find((d) => d.roomId === room.id)!;
      expect(room.doorZone).toEqual({
        x: door.x,
        y: door.y,
        width: door.width,
        height: door.height,
      });
    }
  });

  it("seed seats equal the manifest seats offset by half a tile (tile-centre)", () => {
    const half = manifest.tile.size / 2;
    for (const room of seedRooms) {
      const manifestSeats = manifest.seats.filter((s) => s.roomId === room.id);
      expect(room.seats.length).toBe(manifestSeats.length);
      for (const seat of room.seats) {
        const m = manifestSeats.find((s) => s.seatId === seat.id)!;
        expect({ x: seat.x, y: seat.y, facing: seat.facing }).toEqual({
          x: m.x + half,
          y: m.y + half,
          facing: m.facing,
        });
      }
    }
  });
});
