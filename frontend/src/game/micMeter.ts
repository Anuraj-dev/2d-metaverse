/**
 * Pure mic-level meter mapping (PRD 20). Plain numbers in / out — no WebAudio,
 * React, or DOM. The transport (`media/micLevel`) feeds raw RMS samples (0..1);
 * this module smooths them with a fast attack / slow decay so the meter rises
 * instantly on speech but eases down, and buckets the smoothed level into a fixed
 * number of lit segments the button renders.
 */
export interface MeterConfig {
  /** Fraction of the gap closed per step when the sample is louder (snappy). */
  readonly attack: number;
  /** Fraction closed per step when the sample is quieter (gentle fall). */
  readonly decay: number;
}

export const DEFAULT_METER: MeterConfig = { attack: 0.6, decay: 0.12 };

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Smooth a level toward a new sample: fast attack up, slow decay down. */
export function meterDecay(
  prev: number,
  sample: number,
  cfg: MeterConfig = DEFAULT_METER,
): number {
  const target = clamp01(sample);
  const p = clamp01(prev);
  const rate = target > p ? cfg.attack : cfg.decay;
  return clamp01(p + (target - p) * rate);
}

/** Lit segment count (0..count) for a smoothed level. */
export function meterSegments(level: number, count: number): number {
  if (count <= 0) return 0;
  return Math.round(clamp01(level) * count);
}
