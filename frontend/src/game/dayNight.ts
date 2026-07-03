/**
 * Pure day/night tinting — no Phaser. Maps an hour-of-day (0..24, fractional) to
 * a tint colour + alpha that WorldScene lays over the world as a camera-locked
 * overlay. Keyframed across night → dawn → day → dusk and linearly interpolated,
 * so the campus reads as having a time of day. Cheap atmosphere, no assets.
 */
export interface Tint {
  /** 0xRRGGBB multiply-ish tint colour. */
  color: number;
  /** Overlay strength, 0 (clear midday) .. ~0.45 (deep night). */
  alpha: number;
}

interface Key {
  h: number;
  color: number;
  alpha: number;
}

// Ordered keyframes across a 24h day. First and last must agree (wrap point).
const KEYS: readonly Key[] = [
  { h: 0, color: 0x1a2350, alpha: 0.45 }, // deep night
  { h: 5, color: 0x1a2350, alpha: 0.42 },
  { h: 7, color: 0xffd9a0, alpha: 0.18 }, // warm dawn
  { h: 9, color: 0xffffff, alpha: 0.0 }, // full day
  { h: 16, color: 0xffffff, alpha: 0.0 },
  { h: 18.5, color: 0xff9e5e, alpha: 0.2 }, // amber dusk
  { h: 20.5, color: 0x2a2f66, alpha: 0.38 },
  { h: 24, color: 0x1a2350, alpha: 0.45 },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const bl = Math.round(lerp(ab, bb, t));
  return (r << 16) | (g << 8) | bl;
}

/** Wrap any hour into [0, 24). */
export function normalizeHour(hour: number): number {
  const h = hour % 24;
  return h < 0 ? h + 24 : h;
}

/** The tint for a given hour-of-day (fractional hours allowed). */
export function tintForHour(hour: number): Tint {
  const h = normalizeHour(hour);
  for (let i = 0; i < KEYS.length - 1; i++) {
    const lo = KEYS[i];
    const hi = KEYS[i + 1];
    if (lo && hi && h >= lo.h && h <= hi.h) {
      const span = hi.h - lo.h || 1;
      const t = (h - lo.h) / span;
      return { color: lerpColor(lo.color, hi.color, t), alpha: lerp(lo.alpha, hi.alpha, t) };
    }
  }
  // h == 24 exactly, or unreachable — fall back to the wrap keyframe.
  const last = KEYS[KEYS.length - 1];
  return last ? { color: last.color, alpha: last.alpha } : { color: 0xffffff, alpha: 0 };
}

export type Phase = "night" | "dawn" | "day" | "dusk";

/** A coarse label for the current hour (used for particle/emitter choices). */
export function phaseForHour(hour: number): Phase {
  const h = normalizeHour(hour);
  if (h >= 8 && h < 17) return "day";
  if (h >= 6 && h < 8) return "dawn";
  if (h >= 17 && h < 20.5) return "dusk";
  return "night";
}
