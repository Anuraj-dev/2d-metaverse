/**
 * Deterministic seeded pseudo-random number generator (mulberry32).
 *
 * The arcade games are pure reducers: their randomness (food spawns, pipe gaps,
 * new-tile placement) must be reproducible from a seed + input script so the
 * determinism tests can assert "same seed + same inputs ⇒ identical outcome".
 *
 * The generator state is a single 32-bit integer, so a game state can carry it
 * as a plain `rngSeed: number` field and stay serializable. Draw a value with
 * `nextFloat`/`nextInt`, then write the returned `seed` back into the next
 * state — the reducers never mutate a shared generator.
 */

/** One mulberry32 step: returns a float in [0, 1) and the advanced seed. */
export function nextFloat(seed: number): { value: number; seed: number } {
  let a = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, seed: a >>> 0 };
}

/**
 * Draw an integer in [0, maxExclusive). For `maxExclusive <= 0` returns 0 and
 * still advances the seed so callers stay in lockstep.
 */
export function nextInt(
  seed: number,
  maxExclusive: number
): { value: number; seed: number } {
  const { value, seed: nextSeed } = nextFloat(seed);
  if (maxExclusive <= 0) return { value: 0, seed: nextSeed };
  return { value: Math.floor(value * maxExclusive), seed: nextSeed };
}

/** Normalize an arbitrary number into a valid 32-bit unsigned seed. */
export function toSeed(n: number): number {
  return (Math.floor(n) >>> 0) || 1;
}
