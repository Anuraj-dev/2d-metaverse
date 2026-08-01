import { describe, it, expect } from "vitest";
import {
  initMergeDrop,
  stepMergeDrop,
  tierAt,
  collectPairs,
  BROADPHASE_SLACK,
  DEFAULT_MERGE_DROP_CONFIG,
  IDLE_INPUT,
  PAIR_BASE,
  MAX_CHAIN,
  MAX_TIER,
  MERGE_DROP_TIERS,
  NOVA_SCORE,
  PRESSURE_PHASES,
  phaseFor,
  type MergeBody,
  type MergeDropInput,
  type MergeDropState,
  type PressurePhase,
} from "./mergedrop";

const CFG = DEFAULT_MERGE_DROP_CONFIG;
/** Phase-0 spawn table — what the opening minutes draw from. */
const SPAWN_TABLE = PRESSURE_PHASES[0]?.spawnTable ?? [];

/** Indexed access with a throwing guard — `noUncheckedIndexedAccess`, no `!`. */
function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`no element at index ${index}`);
  return value;
}

/** A body already at rest (born long ago, so the danger grace has expired). */
function body(id: number, tier: number, x: number, y: number): MergeBody {
  return {
    id,
    tier,
    x,
    y,
    px: x,
    py: y,
    r: tierAt(tier).radius,
    bornTick: -10_000,
    fused: false,
    aboveTicks: 0,
  };
}

/** Seed a run with a hand-placed well so a transition can be tested directly. */
function withBodies(seed: number, bodies: MergeBody[]): MergeDropState {
  return { ...initMergeDrop(seed), bodies };
}

const drop = (aimTo: number): MergeDropInput => ({ move: 0, aimTo, drop: true });

/** Floor-resting y for a tier (the well clamps a body to `height - r`). */
const restY = (tier: number) => CFG.height - tierAt(tier).radius;

function fastForward(state: MergeDropState, ticks: number): MergeDropState {
  let s = state;
  for (let i = 0; i < ticks; i++) s = stepMergeDrop(s);
  return s;
}

describe("MERGE_DROP_TIERS", () => {
  it("is a ten-rung ladder with strictly growing radii and payouts", () => {
    expect(MERGE_DROP_TIERS).toHaveLength(10);
    expect(MAX_TIER).toBe(9);
    for (let i = 1; i < MERGE_DROP_TIERS.length; i++) {
      expect(at(MERGE_DROP_TIERS, i).radius).toBeGreaterThan(at(MERGE_DROP_TIERS, i - 1).radius);
      expect(at(MERGE_DROP_TIERS, i).score).toBeGreaterThan(at(MERGE_DROP_TIERS, i - 1).score);
    }
    // The widest body must still fit between the well walls.
    expect(at(MERGE_DROP_TIERS, MAX_TIER).radius * 2).toBeLessThan(CFG.width);
  });

  it("only ever spawns the lower rungs, so the ladder is climbed by merging", () => {
    for (const phase of PRESSURE_PHASES) {
      for (const tier of phase.spawnTable) {
        expect(tier).toBeGreaterThanOrEqual(0);
        expect(tier).toBeLessThan(MAX_TIER);
        expect(at(MERGE_DROP_TIERS, tier).radius * 2).toBeLessThan(CFG.width);
      }
    }
  });

  it("clamps out-of-range tier lookups instead of throwing", () => {
    expect(tierAt(-5)).toBe(at(MERGE_DROP_TIERS, 0));
    expect(tierAt(999)).toBe(at(MERGE_DROP_TIERS, MAX_TIER));
  });
});

describe("initMergeDrop", () => {
  it("starts empty, centred, scoreless and alive", () => {
    const s = initMergeDrop(1);
    expect(s.bodies).toHaveLength(0);
    expect(s.tick).toBe(0);
    expect(s.score).toBe(0);
    expect(s.best).toBe(0);
    expect(s.over).toBe(false);
    expect(s.danger).toBe(0);
    expect(s.events).toHaveLength(0);
    expect(s.aimX).toBe(CFG.width / 2);
  });

  it("holds one spawnable body and previews the next", () => {
    const s = initMergeDrop(1);
    expect(SPAWN_TABLE).toContain(s.current);
    expect(SPAWN_TABLE).toContain(s.next);
  });

  it("is reproducible from its seed alone", () => {
    expect(JSON.stringify(initMergeDrop(77))).toBe(JSON.stringify(initMergeDrop(77)));
  });
});

describe("aiming", () => {
  it("moves the held body with the keyboard axis", () => {
    const s = initMergeDrop(1);
    const right = stepMergeDrop(s, { move: 1, aimTo: null, drop: false });
    expect(right.aimX).toBeCloseTo(s.aimX + CFG.aimSpeed);
    const left = stepMergeDrop(s, { move: -1, aimTo: null, drop: false });
    expect(left.aimX).toBeCloseTo(s.aimX - CFG.aimSpeed);
  });

  it("takes an absolute pointer aim in well coordinates", () => {
    const s = stepMergeDrop(initMergeDrop(1), { move: 0, aimTo: 42, drop: false });
    expect(s.aimX).toBe(42);
  });

  it("never lets the held body overhang a wall", () => {
    const s = initMergeDrop(1);
    const r = tierAt(s.current).radius;
    expect(stepMergeDrop(s, { move: 0, aimTo: -500, drop: false }).aimX).toBe(r);
    expect(stepMergeDrop(s, { move: 0, aimTo: 5000, drop: false }).aimX).toBe(CFG.width - r);
  });
});

describe("dropping", () => {
  it("releases the held body, advances the queue and arms the cooldown", () => {
    const s0 = initMergeDrop(1);
    const s1 = stepMergeDrop(s0, drop(120));
    expect(s1.bodies).toHaveLength(1);
    expect(at(s1.bodies, 0).tier).toBe(s0.current);
    expect(at(s1.bodies, 0).x).toBe(120);
    expect(s1.current).toBe(s0.next);
    expect(SPAWN_TABLE).toContain(s1.next);
    expect(s1.dropCooldown).toBe(CFG.dropCooldown);
    expect(s1.events).toContainEqual({ type: "drop", tier: s0.current, x: 120 });
  });

  it("ignores a drop while the cooldown is running", () => {
    let s = stepMergeDrop(initMergeDrop(1), drop(120));
    for (let i = 0; i < CFG.dropCooldown - 1; i++) s = stepMergeDrop(s, drop(120));
    expect(s.bodies).toHaveLength(1);
    // One more tick retires the cooldown and the next drop lands.
    s = stepMergeDrop(s, drop(120));
    expect(s.bodies).toHaveLength(2);
  });

  it("re-clamps the aim when the newly held body is wider", () => {
    const s0 = { ...initMergeDrop(1), current: 0, next: MAX_TIER - 1 };
    const s1 = stepMergeDrop(s0, drop(tierAt(0).radius));
    expect(s1.aimX).toBe(tierAt(MAX_TIER - 1).radius);
  });
});

describe("physics", () => {
  it("accelerates a dropped body downward under gravity", () => {
    let s = stepMergeDrop(initMergeDrop(1), drop(120));
    const y0 = at(s.bodies, 0).y;
    s = stepMergeDrop(s);
    const y1 = at(s.bodies, 0).y;
    s = stepMergeDrop(s);
    const y2 = at(s.bodies, 0).y;
    expect(y1).toBeGreaterThan(y0);
    expect(y2 - y1).toBeGreaterThan(y1 - y0);
  });

  it("settles a lone body on the floor and leaves it at rest", () => {
    const s0 = stepMergeDrop(initMergeDrop(1), drop(120));
    const tier = at(s0.bodies, 0).tier;
    // 250 ticks: plenty to settle, still inside the phase-0 auto-drop deadline.
    const s = fastForward(s0, 250);
    const b = at(s.bodies, 0);
    expect(b.y).toBeCloseTo(restY(tier), 5);
    expect(Math.abs(b.y - b.py)).toBeLessThan(1e-3);
    expect(Math.abs(b.x - b.px)).toBeLessThan(1e-3);
  });

  it("stacks two bodies instead of letting them interpenetrate", () => {
    // Two different-tier bodies cannot fuse, so they must rest on each other.
    // (250 ticks keeps the run inside the phase-0 auto-drop deadline.)
    const s = fastForward(withBodies(1, [body(1, 0, 130, restY(0)), body(2, 1, 130, restY(0) - 40)]), 250);
    expect(s.bodies).toHaveLength(2);
    const a = at(s.bodies, 0);
    const b = at(s.bodies, 1);
    const d = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    expect(d).toBeGreaterThan(a.r + b.r - 0.5);
  });

  it("keeps every body inside the well across a long scripted run", () => {
    let s = initMergeDrop(2024);
    const aims = [20, 240, 130, 60, 200, 95, 165];
    for (let t = 0; t < 3000 && !s.over; t++) {
      s = stepMergeDrop(s, t % 24 === 0 ? drop(at(aims, (t / 24) % aims.length)) : IDLE_INPUT);
      for (const b of s.bodies) {
        expect(b.x - b.r).toBeGreaterThanOrEqual(-0.5);
        expect(b.x + b.r).toBeLessThanOrEqual(CFG.width + 0.5);
        expect(b.y + b.r).toBeLessThanOrEqual(CFG.height + 0.5);
      }
    }
    expect(s.bodies.length).toBeGreaterThan(0);
  });

  it("never mutates the state it is given", () => {
    const s = stepMergeDrop(initMergeDrop(5), drop(120));
    const before = JSON.stringify(s);
    stepMergeDrop(s, drop(60));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("merging", () => {
  it("fuses two touching bodies of the same tier into the next rung", () => {
    const s = stepMergeDrop(withBodies(1, [body(1, 0, 125, restY(0)), body(2, 0, 140, restY(0))]));
    expect(s.bodies).toHaveLength(1);
    expect(at(s.bodies, 0).tier).toBe(1);
    expect(at(s.bodies, 0).fused).toBe(true);
    expect(s.score).toBe(tierAt(1).score);
    expect(s.best).toBe(1);
    expect(s.events).toContainEqual(
      expect.objectContaining({ type: "merge", tier: 1, chain: 1 })
    );
  });

  it("leaves different tiers alone however close they sit", () => {
    const s = stepMergeDrop(withBodies(1, [body(1, 0, 125, restY(0)), body(2, 1, 140, restY(1))]));
    expect(s.bodies).toHaveLength(2);
    expect(s.score).toBe(0);
    expect(s.events.filter((e) => e.type === "merge")).toHaveLength(0);
  });

  it("leaves same-tier bodies alone while they are apart", () => {
    const s = stepMergeDrop(withBodies(1, [body(1, 0, 40, restY(0)), body(2, 0, 220, restY(0))]));
    expect(s.bodies).toHaveLength(2);
    expect(s.score).toBe(0);
  });

  it("consumes each body once — three in a row fuse a single pair", () => {
    const s = stepMergeDrop(
      withBodies(1, [body(1, 0, 120, restY(0)), body(2, 0, 135, restY(0)), body(3, 0, 150, restY(0))])
    );
    expect(s.events.filter((e) => e.type === "merge")).toHaveLength(1);
    expect(s.bodies).toHaveLength(2);
    expect(s.bodies.filter((b) => b.tier === 1)).toHaveLength(1);
    expect(s.bodies.filter((b) => b.tier === 0)).toHaveLength(1);
  });

  it("multiplies consecutive merges into a chain, capped at MAX_CHAIN", () => {
    const pair = (id: number, x: number) => [body(id, 0, x, restY(0)), body(id + 1, 0, x + 15, restY(0))];
    const s = stepMergeDrop(withBodies(1, [...pair(1, 20), ...pair(3, 120), ...pair(5, 200)]));
    const merges = s.events.filter((e) => e.type === "merge");
    expect(merges).toHaveLength(3);
    expect(merges.map((e) => (e.type === "merge" ? e.chain : 0))).toEqual([1, 2, 3]);
    expect(s.score).toBe(tierAt(1).score * (1 + 2 + 3));
    expect(s.chain).toBe(3);
    expect(MAX_CHAIN).toBeGreaterThan(1);
  });

  it("drops the chain once the window lapses without a merge", () => {
    let s = stepMergeDrop(withBodies(1, [body(1, 0, 125, restY(0)), body(2, 0, 140, restY(0))]));
    expect(s.chain).toBe(1);
    s = fastForward(s, 200);
    expect(s.chain).toBe(0);
  });

  it("goes supernova instead of merging at the top rung", () => {
    const s = stepMergeDrop(withBodies(1, [body(1, MAX_TIER, 90, restY(MAX_TIER)), body(2, MAX_TIER, 170, restY(MAX_TIER))]));
    expect(s.bodies).toHaveLength(0);
    expect(s.novas).toBe(1);
    expect(s.score).toBe(NOVA_SCORE);
    expect(s.events).toContainEqual(expect.objectContaining({ type: "nova", chain: 1 }));
  });
});

describe("danger line and game over", () => {
  it("stays alive while the well is empty", () => {
    // Just short of the phase-0 auto-drop deadline, so the well really is empty.
    const s = fastForward(initMergeDrop(1), at(PRESSURE_PHASES, 0).autoDropTicks - 1);
    expect(s.over).toBe(false);
    expect(s.danger).toBe(0);
    expect(s.stackHeight).toBe(0);
    expect(s.bodies).toHaveLength(0);
  });

  it("reports stack height from the first body, long before any danger", () => {
    // The heat meter reads `stackHeight`, so it must move on an ordinary drop —
    // `danger` alone stays 0 for most of a run and would look broken.
    const low = fastForward(withBodies(1, [body(1, 0, 130, restY(0))]), 5);
    expect(low.stackHeight).toBeGreaterThan(0);
    expect(low.stackHeight).toBeLessThan(0.2);
    expect(low.danger).toBe(0);

    // A body sitting on the danger line pins the readout at full.
    const high = fastForward(withBodies(1, [body(2, 4, 130, CFG.dangerY)]), 1);
    expect(high.stackHeight).toBe(1);
  });

  it("does not spike the heat meter while a fresh drop is still falling", () => {
    // A real release starts at holdY, above the danger line. Counting it would
    // clamp stackHeight to 1 for the whole fall and then recede on landing.
    let s = stepMergeDrop(initMergeDrop(3), drop(130));
    expect(s.bodies).toHaveLength(1);
    let sawFallingExclusion = false;
    // While the fresh (non-fused) body is still falling, the meter stays empty.
    for (let i = 0; i < 40; i++) {
      s = stepMergeDrop(s);
      const b = at(s.bodies, 0);
      const vy = b.y - b.py;
      if (!b.fused && vy > 0.8) {
        expect(s.stackHeight).toBe(0);
        sawFallingExclusion = true;
      }
    }
    expect(sawFallingExclusion).toBe(true);
    // Once it has settled onto the floor the meter reflects the low pile.
    s = fastForward(s, 30);
    expect(s.stackHeight).toBeGreaterThan(0);
    expect(s.stackHeight).toBeLessThan(0.25);
  });

  it("grows the stack-height readout monotonically as the column fills", () => {
    let s = initMergeDrop(5);
    let previous = 0;
    for (let i = 0; i < 8; i++) {
      s = fastForward(stepMergeDrop(s, drop(130)), 120);
      expect(s.stackHeight).toBeGreaterThanOrEqual(previous - 0.001);
      previous = s.stackHeight;
    }
    expect(previous).toBeGreaterThan(0.1);
  });

  it("gives a fresh body a settle grace before it counts as overflow", () => {
    // A body parked above the danger line, born this run: it must not end the
    // run until the settle grace has elapsed.
    const parked: MergeBody = { ...body(1, 4, 130, 30), bornTick: 0 };
    const s = fastForward(withBodies(1, [parked]), CFG.settleTicks - 1);
    expect(at(s.bodies, 0).aboveTicks).toBe(0);
    expect(s.over).toBe(false);
  });

  it("ramps `danger` toward 1 before it ends the run", () => {
    // Held in place by a full column beneath it: spam-drop one column.
    let s = initMergeDrop(99);
    let seenPartialDanger = false;
    for (let t = 0; t < 20_000 && !s.over; t++) {
      s = stepMergeDrop(s, drop(130));
      if (s.danger > 0 && s.danger < 1) seenPartialDanger = true;
    }
    expect(s.over).toBe(true);
    expect(seenPartialDanger).toBe(true);
    expect(s.danger).toBe(1);
    expect(s.events).toContainEqual({ type: "over", score: s.score });
  });

  it("is inert once the run is over — no further scoring or spawning", () => {
    let s = initMergeDrop(99);
    for (let t = 0; t < 20_000 && !s.over; t++) s = stepMergeDrop(s, drop(130));
    expect(s.over).toBe(true);
    const final = { ...s, events: [] };
    const after = stepMergeDrop(s, drop(60));
    expect(JSON.stringify(after)).toBe(JSON.stringify(final));
    expect(stepMergeDrop(after, drop(60))).toBe(after);
  });
});

describe("broad phase", () => {
  /** A dense, settled well built by deterministic scripted play. */
  function denseBodies(): readonly MergeBody[] {
    let s = initMergeDrop(2024);
    const aims = [20, 240, 130, 60, 200, 95, 165];
    let drops = 0;
    for (let t = 0; t < 6000 && !s.over; t++) {
      if (t % 21 === 0) drops++;
      s = stepMergeDrop(s, t % 21 === 0 ? drop(at(aims, drops % aims.length)) : IDLE_INPUT);
    }
    return s.bodies;
  }

  it("finds every pair the narrow phase could accept (brute-force cross-check)", () => {
    const bodies = denseBodies();
    const got = new Set(collectPairs(bodies, BROADPHASE_SLACK));
    const missing: number[] = [];
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = at(bodies, i);
        const b = at(bodies, j);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const reach = a.r + b.r + BROADPHASE_SLACK;
        const withinReach = dx * dx + dy * dy <= reach * reach;
        if (withinReach && !got.has(i * PAIR_BASE + j)) missing.push(i * PAIR_BASE + j);
      }
    }
    expect(missing).toEqual([]);
  });

  it("emits pairs deterministically, in the all-pairs loops' ascending (i, j) order", () => {
    const bodies = denseBodies();
    const pairs = collectPairs(bodies, BROADPHASE_SLACK);
    for (let k = 1; k < pairs.length; k++) {
      // Strictly ascending keys ⇔ unique pairs in lexicographic (i, j) order.
      expect(at(pairs, k)).toBeGreaterThan(at(pairs, k - 1));
    }
    expect(collectPairs(bodies, BROADPHASE_SLACK)).toEqual(pairs);
  });

  it("prunes the quadratic pair space — deterministic operation-count regression", () => {
    const bodies = denseBodies();
    const n = bodies.length;
    // The scenario must be genuinely dense or the bound below proves nothing.
    expect(n).toBeGreaterThanOrEqual(25);
    const candidates = collectPairs(bodies, BROADPHASE_SLACK).length;
    const allPairs = (n * (n - 1)) / 2;
    // Candidate visits stay a small multiple of n (near-contacts), a fraction
    // of the n(n-1)/2 the old six-pass solver + merge scan visited every tick.
    expect(candidates).toBeLessThanOrEqual(n * 8);
    expect(candidates).toBeLessThan(allPairs / 3);
  });
});

describe("solver equivalence (broad phase vs all-pairs reference)", () => {
  /**
   * A slack this large keeps every pair on the candidate list every pass, in
   * the same ascending (i, j) order the naive nested loops used — i.e. the
   * same solver code degrades into the brute-force all-pairs reference.
   */
  const ALL_PAIRS_SLACK = 1_000;

  function withSlack(s: MergeDropState, broadphaseSlack: number): MergeDropState {
    return { ...s, config: { ...s.config, broadphaseSlack } };
  }

  /** Byte-comparable view minus the config (the two solvers differ there by design). */
  function comparable(s: MergeDropState): string {
    return JSON.stringify(s, (key, value: unknown) => (key === "config" ? undefined : value));
  }

  /**
   * Step both solvers in lockstep, demanding byte-identical states every
   * tick; returns how many ticks matched so callers can assert coverage.
   */
  function lockstepTicks(
    seedState: MergeDropState,
    inputAt: (t: number) => MergeDropInput,
    ticks: number
  ): number {
    let fast = seedState;
    let reference = withSlack(seedState, ALL_PAIRS_SLACK);
    let matched = 0;
    for (let t = 0; t < ticks; t++) {
      const input = inputAt(t);
      fast = stepMergeDrop(fast, input);
      reference = stepMergeDrop(reference, input);
      expect(comparable(fast)).toBe(comparable(reference));
      matched++;
    }
    return matched;
  }

  it("matches all-pairs on the round-2 counterexample (correction exceeds the base margin)", () => {
    // Three r-9 bodies at x 100/101/124: resolving (0,1) pushes body 1 right
    // by more than the base slack toward body 2 — the contact a per-tick
    // frozen candidate list provably missed.
    const s = withBodies(1, [
      body(1, 0, 100, restY(0)),
      body(2, 0, 101, restY(0)),
      body(3, 0, 124, restY(0)),
    ]);
    expect(lockstepTicks(s, () => IDLE_INPUT, 60)).toBe(60);
  });

  it("matches all-pairs through a deep-overlap shock with near-margin neighbours", () => {
    // Tier 5 penetrating tier 4 by ~60 units, with bodies parked just past
    // the base margin: the first pass shoves the neighbour many units, so the
    // shock-widened margin must keep every reachable pair on the candidate
    // list within the SAME pass, exactly like all-pairs.
    const y = 300;
    const s = withBodies(2, [
      body(1, 5, 60, y),
      body(2, 4, 61, y),
      body(3, 0, 103, y), // gap ~6 from body 2 — outside the base slack
      body(4, 1, 129, y),
      body(5, 2, 40, y - 80),
    ]);
    expect(lockstepTicks(s, () => IDLE_INPUT, 80)).toBe(80);
  });

  it("matches all-pairs across full seeded runs with drops, merges and settling", () => {
    const aims = [30, 205, 95, 235, 60, 150, 115, 180];
    for (const seed of [11, 2024]) {
      let drops = 0;
      const matched = lockstepTicks(
        initMergeDrop(seed),
        (t) => {
          if (t % 21 === 0) {
            drops++;
            return drop(at(aims, drops % aims.length));
          }
          return IDLE_INPUT;
        },
        1_500
      );
      expect(matched).toBe(1_500);
    }
  });
});

describe("pressure phases", () => {
  const TICKS_PER_MINUTE = 62.5 * 60; // renderer steps every 16ms

  it("ramps monotonically: later phases spawn bigger and force drops sooner", () => {
    expect(at(PRESSURE_PHASES, 0).fromTick).toBe(0);
    const meanTier = (p: PressurePhase) =>
      p.spawnTable.reduce((sum, t) => sum + t, 0) / p.spawnTable.length;
    for (let i = 1; i < PRESSURE_PHASES.length; i++) {
      const prev = at(PRESSURE_PHASES, i - 1);
      const cur = at(PRESSURE_PHASES, i);
      expect(cur.fromTick).toBeGreaterThan(prev.fromTick);
      // Pressure only ever mounts: heavier spawns, tighter forced-drop deadline.
      expect(meanTier(cur)).toBeGreaterThan(meanTier(prev));
      expect(cur.autoDropTicks).toBeLessThan(prev.autoDropTicks);
      expect(cur.spawnTable).toHaveLength(prev.spawnTable.length);
    }
  });

  it("resolves the phase in force at a tick, totally", () => {
    const second = at(PRESSURE_PHASES, 1);
    expect(phaseFor(0)).toBe(at(PRESSURE_PHASES, 0));
    expect(phaseFor(second.fromTick - 1)).toBe(at(PRESSURE_PHASES, 0));
    expect(phaseFor(second.fromTick)).toBe(second);
    expect(phaseFor(10 ** 9)).toBe(at(PRESSURE_PHASES, PRESSURE_PHASES.length - 1));
  });

  it("force-drops the held body once the deadline lapses", () => {
    const deadline = at(PRESSURE_PHASES, 0).autoDropTicks;
    let s = fastForward(initMergeDrop(7), deadline - 1);
    expect(s.bodies).toHaveLength(0);
    s = stepMergeDrop(s);
    expect(s.bodies).toHaveLength(1);
    expect(s.events.some((e) => e.type === "drop")).toBe(true);
    expect(s.lastDropTick).toBe(deadline);
  });

  /**
   * "Mediocre play": a steady drop cadence at cycling aims with no matching
   * strategy. Same seed + same script ⇒ same run, so these bounds are exact
   * regression gates, not statistics.
   */
  function mediocreRun(seed: number, maxTicks: number): MergeDropState {
    const aims = [30, 205, 95, 235, 60, 150, 115, 180];
    let s = initMergeDrop(seed);
    let drops = 0;
    while (!s.over && s.tick < maxTicks) {
      const wantDrop = s.tick % 75 === 0;
      if (wantDrop) drops++;
      s = stepMergeDrop(s, wantDrop ? drop(at(aims, drops % aims.length)) : IDLE_INPUT);
    }
    return s;
  }

  /**
   * A full-ramp simulation costs ~3s locally (per-pass broad-phase
   * recollection makes ticks pricier) and more on slow CI runners, so each
   * seed is simulated ONCE and shared across assertions; only the replay test
   * pays for a deliberate second run. The generous explicit timeouts cover
   * the full-run simulation cost — the assertions themselves are unchanged.
   */
  const mediocreMemo = new Map<number, MergeDropState>();
  function mediocreRunCached(seed: number): MergeDropState {
    const cached = mediocreMemo.get(seed);
    if (cached) return cached;
    const run = mediocreRun(seed, 40_000);
    mediocreMemo.set(seed, run);
    return run;
  }

  it(
    "ends a scripted mediocre run inside the 5-8 minute target window",
    () => {
      for (const seed of [11, 4242]) {
        const s = mediocreRunCached(seed);
        expect(s.over).toBe(true);
        // Fair but relentless: never punishingly fast, never a 15-minute stall.
        expect(s.tick).toBeGreaterThan(4 * TICKS_PER_MINUTE);
        expect(s.tick).toBeLessThan(8.5 * TICKS_PER_MINUTE);
      }
    },
    30_000 // two full-ramp simulations
  );

  it(
    "replays the pressure ramp byte-identically (auto-drops included)",
    () => {
      expect(JSON.stringify(mediocreRun(11, 40_000))).toBe(
        JSON.stringify(mediocreRunCached(11))
      );
    },
    30_000 // one fresh full-ramp simulation against the memoized one
  );

  it("ends even a fully idle run — stalling is not a strategy", () => {
    let s = initMergeDrop(3);
    while (!s.over && s.tick < 60_000) s = stepMergeDrop(s);
    expect(s.over).toBe(true);
  });
});

describe("determinism", () => {
  const script: MergeDropInput[] = Array.from({ length: 1200 }, (_, t) => {
    if (t % 31 === 0) return drop(20 + ((t * 37) % 220));
    if (t % 3 === 0) return { move: 1, aimTo: null, drop: false };
    if (t % 5 === 0) return { move: -1, aimTo: null, drop: false };
    return IDLE_INPUT;
  });

  function replay(seed: number): MergeDropState {
    let s = initMergeDrop(seed);
    for (const input of script) s = stepMergeDrop(s, input);
    return s;
  }

  it("reproduces an identical state from the same seed + input script", () => {
    expect(JSON.stringify(replay(31_337))).toBe(JSON.stringify(replay(31_337)));
  });

  it("diverges for a different seed", () => {
    expect(JSON.stringify(replay(31_337))).not.toBe(JSON.stringify(replay(31_338)));
  });

  it("replays step-for-step, not just at the end", () => {
    let a = initMergeDrop(4242);
    let b = initMergeDrop(4242);
    for (const input of script) {
      a = stepMergeDrop(a, input);
      b = stepMergeDrop(b, input);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
    expect(a.tick).toBe(script.length);
  });

  it("produces a real run — bodies merged, score earned, ladder climbed", () => {
    const s = replay(31_337);
    expect(s.score).toBeGreaterThan(0);
    expect(s.best).toBeGreaterThan(1);
    expect(s.bodies.length).toBeGreaterThan(0);
  });
});
