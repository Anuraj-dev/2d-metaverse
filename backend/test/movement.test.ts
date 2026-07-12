import { describe, expect, it } from "vitest";
import {
  MOVEMENT,
  type GeometryCollision,
  type GeometryPortal,
  type GeometrySolidObject,
} from "@metaverse/shared";
import {
  createWalkability,
  validateMove,
  type MovementAnchor,
  type MovementContext,
  type Walkability,
} from "../src/movement.js";
import { loadGeometryManifest } from "../src/geometry.js";

/**
 * Exhaustive tests for the authoritative movement envelope (PRD 25.21) — the
 * single pure decision point for accept/correct, written from the spec before
 * the socket wiring. Covers the boundary/replay cases the acceptance criteria
 * call out: exact-envelope edge, just-over, legal sprint, hidden-tab/idle burst
 * amortisation, reconnect re-anchor, declared portal jumps (legal) vs a jump to
 * a non-declared destination (rejected), out-of-bounds, and stale/replayed
 * timestamps.
 */

const WORLD = { width: 2000, height: 1500 };
const TILE = 32;

const PORTAL: GeometryPortal = {
  x: 100,
  y: 100,
  width: 32,
  height: 32,
  id: 1,
  targetX: 900,
  targetY: 900,
};

// A walkability grid sized to the test world. `blockedCells` lists [col,row]
// wall/tree tiles; `solids` are furniture centre anchors (pixels). Everything
// else is open — so the envelope tests that don't care about walls stay clean.
const GRID_COLS = Math.ceil(WORLD.width / TILE);
const GRID_ROWS = Math.ceil(WORLD.height / TILE);

function walkableWith(
  blockedCells: ReadonlyArray<readonly [number, number]> = [],
  solids: readonly GeometrySolidObject[] = [],
): Walkability {
  const blocked = new Array<0 | 1>(GRID_COLS * GRID_ROWS).fill(0);
  for (const [col, row] of blockedCells) blocked[row * GRID_COLS + col] = 1;
  const collision: GeometryCollision = { cols: GRID_COLS, rows: GRID_ROWS, blocked };
  return createWalkability(collision, solids, TILE);
}

const OPEN_WALKABLE = walkableWith();

function ctx(overrides: Partial<MovementContext> = {}): MovementContext {
  return {
    world: WORLD,
    portals: [PORTAL],
    walkable: OPEN_WALKABLE,
    tileSize: TILE,
    justEntered: false,
    ...overrides,
  };
}

function anchorAt(x: number, y: number, at = 1_000_000): MovementAnchor {
  return { x, y, at };
}

// Max speed the envelope permits, in px/ms, mirrored from the module's derivation
// so the test asserts against the real budget rather than a magic number.
const MAX_PX_PER_MS =
  (MOVEMENT.walkSpeedPxPerSec * MOVEMENT.runMultiplier * MOVEMENT.envelopeSpeedMultiplier) / 1000;

describe("validateMove — bounds", () => {
  it.each([
    ["negative x", { x: -1, y: 500 }],
    ["negative y", { x: 500, y: -1 }],
    ["beyond width", { x: WORLD.width + 1, y: 500 }],
    ["beyond height", { x: 500, y: WORLD.height + 1 }],
  ])("rejects %s as out-of-bounds", (_label, proposal) => {
    const anchor = anchorAt(500, 500);
    expect(validateMove(anchor, proposal, anchor.at + 100, ctx())).toEqual({
      ok: false,
      reason: "out-of-bounds",
    });
  });

  it("accepts the exact world corner", () => {
    const anchor = anchorAt(WORLD.width - 1, WORLD.height - 1);
    expect(
      validateMove(anchor, { x: WORLD.width, y: WORLD.height }, anchor.at + 100, ctx()),
    ).toEqual({ ok: true });
  });
});

describe("validateMove — speed envelope", () => {
  it("accepts a normal walk step", () => {
    const anchor = anchorAt(500, 500);
    // ~80ms of client cadence, a few px of walk.
    expect(validateMove(anchor, { x: 512, y: 500 }, anchor.at + 80, ctx())).toEqual({
      ok: true,
    });
  });

  it("accepts a legitimate sprint step", () => {
    const anchor = anchorAt(500, 500);
    const dt = 80;
    // Sprint distance over dt (192px/s => ~15px) is well within budget.
    const dist = (MOVEMENT.walkSpeedPxPerSec * MOVEMENT.runMultiplier * dt) / 1000;
    expect(validateMove(anchor, { x: 500 + dist, y: 500 }, anchor.at + dt, ctx())).toEqual({
      ok: true,
    });
  });

  it("accepts a move exactly on the envelope edge", () => {
    const anchor = anchorAt(500, 500);
    const dt = 100;
    const budget = MAX_PX_PER_MS * dt + MOVEMENT.envelopeSlackPx;
    expect(validateMove(anchor, { x: 500 + budget, y: 500 }, anchor.at + dt, ctx())).toEqual({
      ok: true,
    });
  });

  it("rejects a move just over the envelope edge as too-fast", () => {
    const anchor = anchorAt(500, 500);
    const dt = 100;
    const budget = MAX_PX_PER_MS * dt + MOVEMENT.envelopeSlackPx;
    expect(
      validateMove(anchor, { x: 500 + budget + 1, y: 500 }, anchor.at + dt, ctx()),
    ).toEqual({ ok: false, reason: "too-fast" });
  });

  it("rejects a cross-map teleport", () => {
    const anchor = anchorAt(200, 200);
    expect(validateMove(anchor, { x: 1800, y: 1400 }, anchor.at + 80, ctx())).toEqual({
      ok: false,
      reason: "too-fast",
    });
  });

  it("caps elapsed time so an idle client cannot bank a large jump", () => {
    const anchor = anchorAt(500, 500);
    // 10s idle, but the budget is clamped to envelopeMaxElapsedMs.
    const cappedBudget = MAX_PX_PER_MS * MOVEMENT.envelopeMaxElapsedMs + MOVEMENT.envelopeSlackPx;
    expect(
      validateMove(anchor, { x: 500 + cappedBudget + 5, y: 500 }, anchor.at + 10_000, ctx()),
    ).toEqual({ ok: false, reason: "too-fast" });
    // ...but a move within the capped budget after the same idle is fine.
    expect(
      validateMove(anchor, { x: 500 + cappedBudget - 5, y: 500 }, anchor.at + 10_000, ctx()),
    ).toEqual({ ok: true });
  });

  it("amortises a hidden-tab burst: elapsed is clamped, small position delta passes", () => {
    // Tab was throttled for 30s; on return the body barely moved (rAF was paused).
    const anchor = anchorAt(700, 700);
    expect(validateMove(anchor, { x: 706, y: 702 }, anchor.at + 30_000, ctx())).toEqual({
      ok: true,
    });
  });

  it("treats a stale/replayed timestamp (now <= anchor.at) as zero elapsed", () => {
    const anchor = anchorAt(500, 500);
    // Replayed with an older timestamp: no elapsed budget, only the fixed slack.
    expect(validateMove(anchor, { x: 500 + MOVEMENT.envelopeSlackPx, y: 500 }, anchor.at - 5, ctx())).toEqual({
      ok: true,
    });
    expect(
      validateMove(anchor, { x: 500 + MOVEMENT.envelopeSlackPx + 1, y: 500 }, anchor.at - 5, ctx()),
    ).toEqual({ ok: false, reason: "too-fast" });
  });
});

describe("validateMove — portal jumps", () => {
  it("accepts a jump from inside a portal rect to its declared target", () => {
    const anchor = anchorAt(PORTAL.x + 16, PORTAL.y + 16);
    expect(
      validateMove(anchor, { x: PORTAL.targetX, y: PORTAL.targetY }, anchor.at + 80, ctx()),
    ).toEqual({ ok: true });
  });

  it("accepts a target arrival within one-tile tolerance (client rounding + a walk frame)", () => {
    const anchor = anchorAt(PORTAL.x, PORTAL.y);
    expect(
      validateMove(anchor, { x: PORTAL.targetX + TILE, y: PORTAL.targetY }, anchor.at + 80, ctx()),
    ).toEqual({ ok: true });
  });

  it("rejects a portal-sized jump to a NON-declared destination", () => {
    const anchor = anchorAt(PORTAL.x + 16, PORTAL.y + 16);
    // Same origin, but the destination is nowhere near the portal's target.
    expect(
      validateMove(anchor, { x: 1500, y: 1200 }, anchor.at + 80, ctx()),
    ).toEqual({ ok: false, reason: "too-fast" });
  });

  it("rejects a jump to the target when the player was NOT in the portal rect", () => {
    const anchor = anchorAt(800, 300); // far from the portal entrance
    expect(
      validateMove(anchor, { x: PORTAL.targetX, y: PORTAL.targetY }, anchor.at + 80, ctx()),
    ).toEqual({ ok: false, reason: "too-fast" });
  });

  it("still enforces bounds on a portal destination", () => {
    const oobPortal: GeometryPortal = { ...PORTAL, targetX: WORLD.width + 50 };
    const anchor = anchorAt(PORTAL.x, PORTAL.y);
    expect(
      validateMove(
        anchor,
        { x: WORLD.width + 50, y: PORTAL.targetY },
        anchor.at + 80,
        ctx({ portals: [oobPortal] }),
      ),
    ).toEqual({ ok: false, reason: "out-of-bounds" });
  });
});

describe("validateMove — entry re-anchor", () => {
  it("accepts the first move after join/recovery even across a large gap", () => {
    const anchor = anchorAt(500, 500);
    expect(
      validateMove(anchor, { x: 900, y: 900 }, anchor.at + 3000, ctx({ justEntered: true })),
    ).toEqual({ ok: true });
  });

  it("still rejects an out-of-bounds first move", () => {
    const anchor = anchorAt(500, 500);
    expect(
      validateMove(anchor, { x: -10, y: 900 }, anchor.at + 3000, ctx({ justEntered: true })),
    ).toEqual({ ok: false, reason: "out-of-bounds" });
  });

  it("re-anchors onto a blocked tile without a walkability check (trusts recovery)", () => {
    // A recovered client may have kept walking; the re-anchor trusts its reported
    // position, so the walkability gate is intentionally bypassed on entry.
    const walkable = walkableWith([[10, 10]]);
    const anchor = anchorAt(500, 500);
    expect(
      validateMove(anchor, { x: 10 * TILE + 8, y: 10 * TILE + 8 }, anchor.at + 100, ctx({
        justEntered: true,
        walkable,
      })),
    ).toEqual({ ok: true });
  });
});

describe("validateMove — walkability (PRD 25.22)", () => {
  const WALL: readonly [number, number] = [10, 10]; // a blocked wall/tree cell
  const wallX = WALL[0] * TILE + 8;
  const wallY = WALL[1] * TILE + 8;

  it("rejects a standing-pace move onto a blocked tile as 'blocked'", () => {
    // Small honest-sized delta that ends inside a wall — the speed envelope would
    // pass it, so this proves walkability is a distinct, precedence-taking gate.
    const anchor = anchorAt(wallX - TILE, wallY); // adjacent open tile
    expect(
      validateMove(anchor, { x: wallX, y: wallY }, anchor.at + 100, ctx({ walkable: walkableWith([WALL]) })),
    ).toEqual({ ok: false, reason: "blocked" });
  });

  it("accepts a move onto the adjacent walkable tile", () => {
    const anchor = anchorAt(wallX - TILE, wallY);
    expect(
      validateMove(anchor, { x: wallX - TILE + 4, y: wallY }, anchor.at + 100, ctx({
        walkable: walkableWith([WALL]),
      })),
    ).toEqual({ ok: true });
  });

  it("rejects a move onto a solid furniture footprint as 'blocked'", () => {
    const solid: GeometrySolidObject = { key: "f_desk", x: wallX, y: wallY };
    const anchor = anchorAt(wallX - TILE, wallY);
    expect(
      validateMove(anchor, { x: wallX, y: wallY }, anchor.at + 100, ctx({
        walkable: walkableWith([], [solid]),
      })),
    ).toEqual({ ok: false, reason: "blocked" });
  });

  it("takes precedence over the speed envelope for a blocked far jump", () => {
    // A cross-map teleport that also lands in a wall reports 'blocked' (checked
    // before speed), which is the more specific rejection.
    const anchor = anchorAt(100, 100);
    expect(
      validateMove(anchor, { x: wallX, y: wallY }, anchor.at + 50, ctx({ walkable: walkableWith([WALL]) })),
    ).toEqual({ ok: false, reason: "blocked" });
  });

  it("exempts a manifest-declared portal jump from the walkability check", () => {
    // Even if the portal target sat on a blocked tile, the declared teleport is a
    // legal discontinuity (targets are walkable by construction anyway).
    const blockedTarget = walkableWith([
      [Math.floor(PORTAL.targetX / TILE), Math.floor(PORTAL.targetY / TILE)],
    ]);
    const anchor = anchorAt(PORTAL.x, PORTAL.y);
    expect(
      validateMove(anchor, { x: PORTAL.targetX, y: PORTAL.targetY }, anchor.at + 80, ctx({
        walkable: blockedTarget,
      })),
    ).toEqual({ ok: true });
  });

  it("clamps the exact far world edge onto the last tile (no out-of-grid read)", () => {
    // x === world.width floors to `cols` (one past the grid); the lookup clamps
    // it back onto the last column rather than reading undefined.
    const anchor = anchorAt(WORLD.width - TILE, WORLD.height - TILE, 1_000_000);
    expect(
      validateMove(anchor, { x: WORLD.width, y: WORLD.height }, anchor.at + 100, ctx()),
    ).toEqual({ ok: true });
  });
});

describe("createWalkability — real campus manifest", () => {
  // Exercises the real generated grid so a manifest regen that moves a wall,
  // door, or furniture is caught here rather than only in E2E.
  const manifest = loadGeometryManifest();
  const walkable = createWalkability(
    manifest.collision,
    manifest.solidObjects,
    manifest.tile.size,
  );

  it("marks a known wall tile blocked", () => {
    expect(walkable.isBlockedAtPixel(1300, 706)).toBe(true);
  });

  it("keeps the spawn tile and a door threshold walkable", () => {
    expect(walkable.isBlockedAtPixel(manifest.spawn.x, manifest.spawn.y)).toBe(false);
    const door = manifest.doors[0];
    if (!door) throw new Error("expected the campus manifest to declare a door");
    const cx = door.x + Math.floor(door.width / 2);
    const cy = door.y + Math.floor(door.height / 2);
    expect(walkable.isBlockedAtPixel(cx, cy)).toBe(false);
  });

  it("blocks a solid furniture centre that the wall grid alone leaves open", () => {
    const solid = manifest.solidObjects[0];
    if (!solid) throw new Error("expected the campus manifest to declare solid furniture");
    expect(walkable.isBlockedAtPixel(solid.x, solid.y)).toBe(true);
  });
});
