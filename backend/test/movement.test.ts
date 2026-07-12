import { describe, expect, it } from "vitest";
import { MOVEMENT, type GeometryPortal } from "@metaverse/shared";
import {
  validateMove,
  type MovementAnchor,
  type MovementContext,
} from "../src/movement.js";

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

function ctx(overrides: Partial<MovementContext> = {}): MovementContext {
  return {
    world: WORLD,
    portals: [PORTAL],
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
});
