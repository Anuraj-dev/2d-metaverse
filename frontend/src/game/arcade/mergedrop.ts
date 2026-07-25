/**
 * Stellar Forge — the pure merge-drop reducer (Arcade 2.0, ticket #164).
 *
 * The player releases celestial bodies into a gravity well; two bodies of the
 * same tier that touch fuse into the next tier up (pebble → … → sun), and two
 * suns go supernova for a big bonus. Letting the stack sit above the danger
 * line ends the run.
 *
 * Same contract as every other arcade module: plain values in, plain values
 * out, no Phaser / net / DOM imports, and every random draw flows through a
 * serializable `rngSeed` (mulberry32, see ./prng) so a run is reproducible from
 * `seed + input script`. Race mode replays these states, so determinism is
 * load-bearing, not cosmetic — the physics therefore uses ONLY `+ - * /` and
 * `Math.sqrt` (all exactly-rounded in IEEE-754) plus `Math.floor`/`Math.min`/
 * `Math.max`. No `Math.pow`, `Math.hypot`, `Math.sin`, no wall-clock time, and
 * every loop walks a fixed index order so the float sequence never depends on
 * iteration order, engine version or platform. Pair visits are pruned by a
 * deterministic sweep-and-prune broad phase (`collectPairs`) whose candidate
 * list is re-sorted into ascending (i, j) — the same order the naive all-pairs
 * loops used — so pruning changes cost, never outcomes.
 *
 * Integration is position-based (Verlet): a body carries its previous position
 * instead of a velocity, contacts are solved as positional corrections over a
 * fixed number of relaxation passes, and the implied velocity falls out of the
 * position delta. That settles piles calmly without an external physics engine.
 *
 * All presentation (colours, sprites, particles, wobble) is derived from this
 * state by the renderer — the tier table below carries only plain data.
 */

import { nextInt } from "./prng";

/** One rung of the evolution ladder. `score` is awarded when a merge PRODUCES it. */
export interface MergeTier {
  /** Display name, shown on the evolution ladder. */
  readonly name: string;
  /** Collision radius, in well units. */
  readonly radius: number;
  /** Points awarded for producing one of these (0 for the spawn-only base tier). */
  readonly score: number;
  /** Base body colour (plain data — the renderer owns all drawing). */
  readonly color: string;
  /** Terminator/shadow colour. */
  readonly shade: string;
  /** Rim-light / glow colour. */
  readonly light: string;
}

/**
 * The evolution ladder, smallest → largest. Ten rungs, original space theme.
 * Radii grow ~1.25x per rung so a merge always reads as a clear step up.
 */
export const MERGE_DROP_TIERS: readonly MergeTier[] = [
  { name: "Pebble",     radius:  9, score:   0, color: "#9aa3b2", shade: "#5d6473", light: "#d7dce6" },
  { name: "Meteoroid",  radius: 12, score:   2, color: "#b08968", shade: "#6d5240", light: "#e6c9a8" },
  { name: "Asteroid",   radius: 16, score:   4, color: "#8d99ae", shade: "#525b6d", light: "#d3dbe8" },
  { name: "Comet",      radius: 21, score:   8, color: "#7ee8fa", shade: "#2f7f96", light: "#dcfbff" },
  { name: "Moon",       radius: 27, score:  16, color: "#d9dbe3", shade: "#82868f", light: "#ffffff" },
  { name: "Terra",      radius: 34, score:  32, color: "#4f9d69", shade: "#25553b", light: "#9fe0b4" },
  { name: "Ice Giant",  radius: 42, score:  64, color: "#4cc9f0", shade: "#1d6d8c", light: "#c4f1ff" },
  { name: "Gas Giant",  radius: 51, score: 128, color: "#f4a261", shade: "#8c5227", light: "#ffe0bd" },
  { name: "Dwarf Star", radius: 61, score: 256, color: "#ffd166", shade: "#a3762a", light: "#fff4cf" },
  { name: "Sun",        radius: 72, score: 512, color: "#ff7b00", shade: "#a83c00", light: "#ffdba1" },
];

/** Index of the top rung — two of these go supernova instead of merging. */
export const MAX_TIER = MERGE_DROP_TIERS.length - 1;

/** Bonus for a supernova (two suns annihilating). */
export const NOVA_SCORE = 1024;

/**
 * Mounting-pressure schedule (review round 1, owner finding): a casual run must
 * genuinely end, in roughly 5-8 minutes. Two deterministic, tick-driven knobs
 * ramp together across phases:
 *
 * - `spawnTable`: the fixed 8-slot draw table for the held body (one
 *   `nextInt(seed, 8)` per draw) widens toward the middle rungs, so later
 *   phases pour area into the well faster (each rung is ~1.56x the area of the
 *   one below) while easy same-tier pairs grow scarcer.
 * - `autoDropTicks`: the forced-drop deadline. Once the player has gone this
 *   many ticks without a drop, the held body releases itself at the current
 *   aim — stalling forever above a full well is not a strategy.
 *
 * Both derive from `state.tick` alone (never wall-clock), so replays stay
 * byte-identical. The balance tests script a mediocre run and assert it
 * overflows inside the target window, and that both knobs are monotone.
 */
export interface PressurePhase {
  /** First tick this phase applies to (phases are sorted ascending). */
  readonly fromTick: number;
  /** 8-slot spawn table for the held-body draw. */
  readonly spawnTable: readonly number[];
  /** Forced-drop deadline, in ticks since the last drop. */
  readonly autoDropTicks: number;
}

/** ~62.5 ticks/sec at the renderer's 16ms timestep: phase edges below are minutes. */
export const PRESSURE_PHASES: readonly PressurePhase[] = [
  { fromTick: 0,      spawnTable: [0, 0, 0, 1, 1, 2, 2, 3], autoDropTicks: 300 }, // 0:00
  { fromTick: 5_000,  spawnTable: [0, 0, 1, 1, 2, 2, 3, 3], autoDropTicks: 240 }, // 1:20
  { fromTick: 10_000, spawnTable: [0, 1, 1, 2, 2, 3, 3, 3], autoDropTicks: 200 }, // 2:40
  { fromTick: 15_000, spawnTable: [0, 1, 1, 2, 2, 3, 3, 4], autoDropTicks: 160 }, // 4:00
  { fromTick: 20_000, spawnTable: [1, 1, 2, 2, 3, 3, 4, 4], autoDropTicks: 120 }, // 5:20
];

/** The pressure phase in force at `tick` (total: phase 0 starts at tick 0). */
export function phaseFor(tick: number): PressurePhase {
  let phase = PRESSURE_PHASES[0];
  for (const p of PRESSURE_PHASES) {
    if (tick >= p.fromTick) phase = p;
  }
  if (!phase) throw new Error("merge-drop: PRESSURE_PHASES is empty");
  return phase;
}

/** Consecutive-merge window (ticks) and the cap on the chain multiplier. */
export const CHAIN_WINDOW = 45;
export const MAX_CHAIN = 4;

/** Absolute slack (well units) added to the contact test before two bodies fuse. */
export const MERGE_SLACK = 1;

export interface MergeDropConfig {
  /** Well interior width; x runs 0..width. */
  readonly width: number;
  /** Well interior height; y runs 0..height (0 = rim, height = floor). */
  readonly height: number;
  /** y of the held body's centre, above the danger line. */
  readonly holdY: number;
  /** Bodies whose top edge sits above this y are "in the danger zone". */
  readonly dangerY: number;
  /** Downward acceleration, well units per tick². */
  readonly gravity: number;
  /** Per-tick velocity retention (air drag). */
  readonly damping: number;
  /** Hard cap on a body's per-tick travel, so nothing tunnels through a contact. */
  readonly maxSpeed: number;
  /** Relaxation passes per tick for contacts + walls. */
  readonly iterations: number;
  /** Fraction of an overlap removed per relaxation pass. */
  readonly separation: number;
  /** Velocity kept when a body reflects off a wall / the floor. */
  readonly restitution: number;
  /** Horizontal velocity retained per tick while touching the floor. */
  readonly friction: number;
  /** Ticks between two drops. */
  readonly dropCooldown: number;
  /** Aim travel per tick while a direction is held. */
  readonly aimSpeed: number;
  /** Ticks a fresh body is exempt from the danger check (it needs to fall first). */
  readonly settleTicks: number;
  /** Consecutive danger-zone ticks that end the run. */
  readonly dangerTicks: number;
}

export const DEFAULT_MERGE_DROP_CONFIG: MergeDropConfig = {
  width: 260,
  height: 420,
  holdY: 26,
  dangerY: 78,
  gravity: 0.4,
  damping: 0.99,
  maxSpeed: 9,
  iterations: 6,
  separation: 0.55,
  restitution: 0.22,
  friction: 0.94,
  dropCooldown: 20,
  aimSpeed: 3.4,
  settleTicks: 90,
  dangerTicks: 90,
};

/** One celestial body in the well. Verlet: `px/py` is the previous position. */
export interface MergeBody {
  readonly id: number;
  readonly tier: number;
  x: number;
  y: number;
  px: number;
  py: number;
  readonly r: number;
  /** Tick the body entered play (spawn or merge) — starts its settle grace. */
  readonly bornTick: number;
  /** True when the body was produced by a merge (drives the renderer's pop). */
  readonly fused: boolean;
  /** Consecutive ticks spent in the danger zone past the settle grace. */
  aboveTicks: number;
}

/** Domain events produced by one step — the renderer turns these into juice + bus events. */
export type MergeDropEvent =
  | { readonly type: "drop"; readonly tier: number; readonly x: number }
  | {
      readonly type: "merge";
      /** Tier PRODUCED by the merge. */
      readonly tier: number;
      readonly x: number;
      readonly y: number;
      readonly chain: number;
    }
  | { readonly type: "nova"; readonly x: number; readonly y: number; readonly chain: number }
  | { readonly type: "over"; readonly score: number };

export interface MergeDropState {
  readonly config: MergeDropConfig;
  readonly tick: number;
  /** mulberry32 state — the only source of randomness. */
  readonly rngSeed: number;
  readonly bodies: readonly MergeBody[];
  /** Tier of the body held above the well. */
  readonly current: number;
  /** Tier of the body queued after it (the preview). */
  readonly next: number;
  /** Centre x of the held body, clamped so it always fits inside the well. */
  readonly aimX: number;
  readonly dropCooldown: number;
  /** Tick of the last drop — the phase's `autoDropTicks` deadline counts from here. */
  readonly lastDropTick: number;
  readonly score: number;
  /** Highest tier produced so far — lights the evolution ladder. */
  readonly best: number;
  /** Merges resolved inside the current chain window. */
  readonly chain: number;
  readonly lastMergeTick: number;
  readonly novas: number;
  readonly over: boolean;
  readonly nextId: number;
  /**
   * 0..1 — how full the well is: the tallest body's top edge measured from the
   * floor toward the danger line (1 = the stack has reached the line). This is
   * the readout the heat meter shows, so the player gets continuous feedback
   * long before `danger` starts ticking.
   */
  readonly stackHeight: number;
  /** 0..1 — how close the tallest danger-zone body is to ending the run. */
  readonly danger: number;
  /** Events produced by the step that returned this state. */
  readonly events: readonly MergeDropEvent[];
}

/** Per-tick player input. `aimTo` is an absolute well-x (pointer), applied first. */
export interface MergeDropInput {
  readonly move: -1 | 0 | 1;
  readonly aimTo: number | null;
  readonly drop: boolean;
}

export const IDLE_INPUT: MergeDropInput = { move: 0, aimTo: null, drop: false };

/** Clamp a tier index into the ladder. */
function clampTier(index: number): number {
  return Math.max(0, Math.min(MAX_TIER, Math.floor(index)));
}

/** Look up a rung. Total by construction (the index is clamped) — no assertions. */
export function tierAt(index: number): MergeTier {
  const tier = MERGE_DROP_TIERS[clampTier(index)];
  if (!tier) throw new Error(`merge-drop: no tier at index ${index}`);
  return tier;
}

/** Draw the next held tier from the tick's phase spawn table, advancing the seed. */
function drawTier(seed: number, tick: number): { tier: number; seed: number } {
  const table = phaseFor(tick).spawnTable;
  const { value, seed: nextSeed } = nextInt(seed, table.length);
  const tier = table[value] ?? 0;
  return { tier, seed: nextSeed };
}

/** Keep the held body fully inside the well for its radius. */
function clampAim(x: number, radius: number, config: MergeDropConfig): number {
  const min = radius;
  const max = config.width - radius;
  if (max <= min) return config.width / 2;
  return Math.max(min, Math.min(max, x));
}

/** A fresh run: empty well, first body held, second previewed. */
export function initMergeDrop(
  seed: number,
  config: MergeDropConfig = DEFAULT_MERGE_DROP_CONFIG
): MergeDropState {
  const first = drawTier(seed, 0);
  const second = drawTier(first.seed, 0);
  return {
    config,
    tick: 0,
    rngSeed: second.seed,
    bodies: [],
    current: first.tier,
    next: second.tier,
    aimX: clampAim(config.width / 2, tierAt(first.tier).radius, config),
    dropCooldown: 0,
    lastDropTick: 0,
    score: 0,
    best: 0,
    chain: 0,
    lastMergeTick: -CHAIN_WINDOW - 1,
    novas: 0,
    over: false,
    nextId: 1,
    stackHeight: 0,
    danger: 0,
    events: [],
  };
}

/** Working copy of a body — the reducer never mutates the state handed to it. */
function cloneBody(b: MergeBody): MergeBody {
  return {
    id: b.id,
    tier: b.tier,
    x: b.x,
    y: b.y,
    px: b.px,
    py: b.py,
    r: b.r,
    bornTick: b.bornTick,
    fused: b.fused,
    aboveTicks: b.aboveTicks,
  };
}

/** Advance the implied velocity by one tick (Verlet), damped and speed-capped. */
function integrate(bodies: MergeBody[], config: MergeDropConfig): void {
  const { damping, gravity, maxSpeed } = config;
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (!b) continue;
    let vx = (b.x - b.px) * damping;
    let vy = (b.y - b.py) * damping + gravity;
    // Speed cap: a body must never travel further than a small radius in one
    // tick, or it could pass straight through a contact between two passes.
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > maxSpeed) {
      const scale = maxSpeed / speed;
      vx = vx * scale;
      vy = vy * scale;
    }
    b.px = b.x;
    b.py = b.y;
    b.x = b.x + vx;
    b.y = b.y + vy;
  }
}

/** Push one pair apart along their centre line, split by area-proportional mass. */
function resolvePair(a: MergeBody, b: MergeBody, separation: number): void {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const min = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return;
  let d = Math.sqrt(d2);
  if (d === 0) {
    // Exactly co-located (two bodies fused into the same spot): separate along
    // a fixed axis so the outcome stays independent of any float accident.
    dx = 0;
    dy = 1;
    d = 1;
  }
  const nx = dx / d;
  const ny = dy / d;
  const overlap = (min - d) * separation;
  const ma = a.r * a.r;
  const mb = b.r * b.r;
  const total = ma + mb;
  const shareA = mb / total;
  const shareB = ma / total;
  a.x = a.x - nx * overlap * shareA;
  a.y = a.y - ny * overlap * shareA;
  b.x = b.x + nx * overlap * shareB;
  b.y = b.y + ny * overlap * shareB;
}

/**
 * Positional-only well clamp, run in every relaxation pass. Leaving `px/py`
 * alone is what makes a pile settle: the implied velocity shrinks to whatever
 * the clamp allowed, so a body pressed into the floor simply stops.
 */
function clampIntoWell(b: MergeBody, config: MergeDropConfig): void {
  if (b.x - b.r < 0) b.x = b.r;
  else if (b.x + b.r > config.width) b.x = config.width - b.r;
  if (b.y + b.r > config.height) b.y = config.height - b.r;
}

/** Contact width used when deciding whether a body is resting on a boundary. */
const CONTACT_EPS = 0.01;

/**
 * Boundary velocity response — applied ONCE per tick, after the relaxation
 * passes. (Doing it inside the pass loop would compound the drag by
 * `friction ** iterations` and make the feel depend on the iteration count.)
 */
function applyBoundaryResponse(b: MergeBody, config: MergeDropConfig): void {
  if (b.y + b.r >= config.height - CONTACT_EPS) {
    const vy = b.y - b.py;
    // Reflect a downward impact into a small, heavily damped bounce.
    if (vy > 0) b.py = b.y + vy * config.restitution;
    // Floor drag, so a pile stops sliding instead of drifting forever.
    b.px = b.x - (b.x - b.px) * config.friction;
  }
  const vx = b.x - b.px;
  if (b.x - b.r <= CONTACT_EPS && vx < 0) b.px = b.x + vx * config.restitution;
  else if (b.x + b.r >= config.width - CONTACT_EPS && vx > 0) {
    b.px = b.x + vx * config.restitution;
  }
}

/**
 * Broad-phase margin (well units): candidate pairs are collected once per tick
 * from slack-expanded AABBs, then reused across all relaxation passes. The
 * margin absorbs the small positional corrections a pass can apply, so a pair
 * driven into contact mid-solve is still on the candidate list.
 */
export const BROADPHASE_SLACK = 4;

/** Pair-key radix (`key = i * PAIR_BASE + j`). Body counts stay orders of magnitude below this. */
export const PAIR_BASE = 2 ** 20;

/**
 * Deterministic sweep-and-prune broad phase. Returns the pairs whose
 * slack-expanded AABBs overlap, encoded `i * PAIR_BASE + j` with `i < j`, and
 * sorted ascending — i.e. re-sorted into the exact lexicographic (i, j) order
 * the old all-pairs loops visited. The pairs it prunes are separated by more
 * than `slack` on an axis, which both the contact solver and the merge scan
 * would have rejected on distance anyway, so narrow-phase outcomes (and replay
 * determinism) are unchanged; only the wasted pair visits go away.
 *
 * Determinism: the sweep sorts on plain float comparisons with index
 * tie-breaks (a total order), and the output order is fully normalized by the
 * final numeric sort — nothing depends on engine sort stability.
 */
export function collectPairs(bodies: readonly MergeBody[], slack: number): number[] {
  const n = bodies.length;
  // Sweep along y (piles spread across rows, so y prunes best): sort indices
  // by each body's expanded top edge.
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
  order.sort((ia, ib) => {
    const a = bodies[ia];
    const b = bodies[ib];
    const ka = a ? a.y - a.r : 0;
    const kb = b ? b.y - b.r : 0;
    return ka === kb ? ia - ib : ka - kb;
  });

  const keys: number[] = [];
  for (let s = 0; s < n; s++) {
    const ia = order[s];
    if (ia === undefined) continue;
    const a = bodies[ia];
    if (!a) continue;
    const aBottom = a.y + a.r + slack;
    for (let t = s + 1; t < n; t++) {
      const ib = order[t];
      if (ib === undefined) continue;
      const b = bodies[ib];
      if (!b) continue;
      // Sorted by top edge: once a body starts below a's expanded bottom,
      // every later one does too.
      if (b.y - b.r > aBottom) break;
      const dx = b.x - a.x;
      const reach = a.r + b.r + slack;
      if (dx > reach || dx < -reach) continue;
      keys.push(ia < ib ? ia * PAIR_BASE + ib : ib * PAIR_BASE + ia);
    }
  }
  keys.sort((x, y) => x - y);
  return keys;
}

/** Fixed-order relaxation passes: every candidate contact, then every well boundary. */
function solve(bodies: MergeBody[], config: MergeDropConfig): void {
  const pairs = collectPairs(bodies, BROADPHASE_SLACK);
  for (let pass = 0; pass < config.iterations; pass++) {
    for (let k = 0; k < pairs.length; k++) {
      const key = pairs[k];
      if (key === undefined) continue;
      const i = Math.floor(key / PAIR_BASE);
      const a = bodies[i];
      const b = bodies[key - i * PAIR_BASE];
      if (!a || !b) continue;
      resolvePair(a, b, config.separation);
    }
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b) continue;
      clampIntoWell(b, config);
    }
  }
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (!b) continue;
    applyBoundaryResponse(b, config);
  }
}

/**
 * Advance the run by one fixed tick.
 *
 * Order is fixed and total: aim → drop → integrate → solve contacts → fuse
 * touching pairs → danger check. A finished run is inert (the same state is
 * returned with its events cleared), so a renderer that keeps ticking after
 * game-over cannot corrupt the final score.
 */
export function stepMergeDrop(
  state: MergeDropState,
  input: MergeDropInput = IDLE_INPUT
): MergeDropState {
  if (state.over) {
    return state.events.length === 0 ? state : { ...state, events: [] };
  }

  const config = state.config;
  const tick = state.tick + 1;
  const events: MergeDropEvent[] = [];
  const bodies = state.bodies.map(cloneBody);

  // ── 1. Aim ────────────────────────────────────────────────────────────────
  let current = state.current;
  let next = state.next;
  let rngSeed = state.rngSeed;
  let nextId = state.nextId;
  const heldRadius = tierAt(current).radius;
  const aimed = input.aimTo === null ? state.aimX : input.aimTo;
  let aimX = clampAim(aimed + input.move * config.aimSpeed, heldRadius, config);

  // ── 2. Drop ───────────────────────────────────────────────────────────────
  let dropCooldown = Math.max(0, state.dropCooldown - 1);
  let lastDropTick = state.lastDropTick;
  // Pressure: past the phase deadline the held body releases itself. Derived
  // from ticks only, so replays are unaffected by when the player blinked.
  const forcedDrop = tick - state.lastDropTick >= phaseFor(tick).autoDropTicks;
  if ((input.drop || forcedDrop) && dropCooldown === 0) {
    bodies.push({
      id: nextId,
      tier: current,
      x: aimX,
      y: config.holdY,
      px: aimX,
      py: config.holdY,
      r: heldRadius,
      bornTick: tick,
      fused: false,
      aboveTicks: 0,
    });
    events.push({ type: "drop", tier: current, x: aimX });
    nextId = nextId + 1;
    current = next;
    const drawn = drawTier(rngSeed, tick);
    next = drawn.tier;
    rngSeed = drawn.seed;
    dropCooldown = config.dropCooldown;
    lastDropTick = tick;
    // The new held body may be wider than the one just released.
    aimX = clampAim(aimX, tierAt(current).radius, config);
  }

  // ── 3+4. Physics ──────────────────────────────────────────────────────────
  integrate(bodies, config);
  solve(bodies, config);

  // ── 5. Fuse touching same-tier pairs ──────────────────────────────────────
  let score = state.score;
  let best = state.best;
  let novas = state.novas;
  let chain = tick - state.lastMergeTick <= CHAIN_WINDOW ? state.chain : 0;
  let lastMergeTick = state.lastMergeTick;
  const consumed: boolean[] = bodies.map(() => false);
  const fused: MergeBody[] = [];

  // Same broad phase as the solver. Bodies do not move during this scan, so
  // with MERGE_SLACK as the margin the candidate set provably contains every
  // pair within touching distance — identical outcomes to the old full scan,
  // visited in the same ascending (i, j) order.
  const mergePairs = collectPairs(bodies, MERGE_SLACK);
  for (let k = 0; k < mergePairs.length; k++) {
    const key = mergePairs[k];
    if (key === undefined) continue;
    const i = Math.floor(key / PAIR_BASE);
    const j = key - i * PAIR_BASE;
    if (consumed[i] || consumed[j]) continue;
    const a = bodies[i];
    const b = bodies[j];
    if (!a || !b || b.tier !== a.tier) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const touch = a.r + b.r + MERGE_SLACK;
    if (dx * dx + dy * dy > touch * touch) continue;

    consumed[i] = true;
    consumed[j] = true;
    chain = chain + 1;
    lastMergeTick = tick;
    const multiplier = Math.min(chain, MAX_CHAIN);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;

    if (a.tier >= MAX_TIER) {
      // Two suns annihilate: a supernova clears both and pays a bonus.
      score = score + NOVA_SCORE * multiplier;
      novas = novas + 1;
      events.push({ type: "nova", x: cx, y: cy, chain: multiplier });
      continue;
    }

    const tier = a.tier + 1;
    const rung = tierAt(tier);
    score = score + rung.score * multiplier;
    best = Math.max(best, tier);
    // Inherit the pair's averaged momentum so a merge nudges the pile.
    const vx = (a.x - a.px + (b.x - b.px)) / 2;
    const vy = (a.y - a.py + (b.y - b.py)) / 2;
    const born: MergeBody = {
      id: nextId,
      tier,
      x: cx,
      y: cy,
      px: cx - vx,
      py: cy - vy,
      r: rung.radius,
      bornTick: tick,
      fused: true,
      aboveTicks: 0,
    };
    // The new body is wider than the two it replaced, so it can straddle a
    // wall on the tick it appears — clamp it before anything renders it.
    clampIntoWell(born, config);
    fused.push(born);
    nextId = nextId + 1;
    events.push({ type: "merge", tier, x: cx, y: cy, chain: multiplier });
  }

  const survivors: MergeBody[] = [];
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (!b || consumed[i]) continue;
    survivors.push(b);
  }
  for (const b of fused) survivors.push(b);

  // ── 6. Danger line / game over ────────────────────────────────────────────
  let over = false;
  let danger = 0;
  let stackTop = config.height;
  for (const b of survivors) {
    const top = b.y - b.r;
    if (top < stackTop) stackTop = top;
    const settled = tick - b.bornTick >= config.settleTicks;
    if (settled && top < config.dangerY) b.aboveTicks = b.aboveTicks + 1;
    else b.aboveTicks = 0;
    if (b.aboveTicks > danger) danger = b.aboveTicks;
    if (b.aboveTicks >= config.dangerTicks) over = true;
  }
  if (over) events.push({ type: "over", score });
  const span = config.height - config.dangerY;
  const stackHeight =
    span > 0 ? Math.max(0, Math.min(1, (config.height - stackTop) / span)) : 0;

  return {
    config,
    tick,
    rngSeed,
    bodies: survivors,
    current,
    next,
    aimX,
    dropCooldown,
    lastDropTick,
    score,
    best,
    chain,
    lastMergeTick,
    novas,
    over,
    nextId,
    stackHeight,
    danger: config.dangerTicks > 0 ? Math.min(1, danger / config.dangerTicks) : 0,
    events,
  };
}
