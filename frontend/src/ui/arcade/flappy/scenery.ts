/**
 * Flappy backdrop + ground art: sky, sun, parallax clouds, city skyline, rolling
 * hills, bushes and the scrolling dirt strip. Everything is procedural and
 * driven by the state's `scroll`, so there are no assets to ship and the
 * parallax stays in lockstep with the pipes.
 */
import type { FlappyState } from "../../../game/arcade/flappy";
import { hash } from "./util";

export interface Cloud {
  /** Base x before parallax; wrapped at draw time. */
  x: number;
  y: number;
  /** Scale. */
  s: number;
  /** Alpha. */
  a: number;
  /** Parallax factor against `scroll`. */
  d: number;
}

/** Deterministic cloud field for a given play area (built once per run). */
export function buildClouds(width: number, groundY: number): Cloud[] {
  const clouds: Cloud[] = [];
  const n = Math.max(5, Math.round(width / 170));
  for (let i = 0; i < n; i++) {
    clouds.push({
      x: (i + hash(i * 3.7) * 0.8) * (width / n) * 1.15,
      y: 40 + hash(i * 9.1) * (groundY * 0.42),
      s: 0.55 + hash(i * 5.3) * 0.85,
      a: 0.42 + hash(i * 2.1) * 0.42,
      d: 0.055 + hash(i * 7.7) * 0.09,
    });
  }
  return clouds;
}

function drawSky(ctx: CanvasRenderingContext2D, width: number, groundY: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0.0, "#1e6fa8");
  sky.addColorStop(0.28, "#3d9dc4");
  sky.addColorStop(0.58, "#67c3d6");
  sky.addColorStop(0.82, "#a8dfd8");
  sky.addColorStop(1.0, "#dcefc4");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, groundY + 2);

  // Sun + soft glow.
  const sx = width * 0.78;
  const sy = groundY * 0.2;
  const glow = ctx.createRadialGradient(sx, sy, 4, sx, sy, groundY * 0.42);
  glow.addColorStop(0, "rgba(255,248,214,0.95)");
  glow.addColorStop(0.16, "rgba(255,240,180,0.42)");
  glow.addColorStop(1, "rgba(255,236,170,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sx, sy, groundY * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,252,232,0.9)";
  ctx.beginPath();
  ctx.arc(sx, sy, 26, 0, Math.PI * 2);
  ctx.fill();
}

function cloudBlob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  alpha: number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  // Shadowed underside.
  ctx.fillStyle = `rgba(198,224,236,${alpha * 0.85})`;
  ctx.beginPath();
  ctx.arc(-34, 8, 22, 0, Math.PI * 2);
  ctx.arc(-6, 14, 26, 0, Math.PI * 2);
  ctx.arc(26, 10, 21, 0, Math.PI * 2);
  ctx.arc(2, -4, 30, 0, Math.PI * 2);
  ctx.fill();
  // Bright top.
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.beginPath();
  ctx.arc(-30, 0, 19, 0, Math.PI * 2);
  ctx.arc(-2, -10, 27, 0, Math.PI * 2);
  ctx.arc(24, 1, 19, 0, Math.PI * 2);
  ctx.arc(4, 6, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawClouds(
  ctx: CanvasRenderingContext2D,
  clouds: readonly Cloud[],
  scroll: number,
  width: number
): void {
  const span = width + 260;
  for (const c of clouds) {
    const x = (((c.x - scroll * c.d) % span) + span) % span - 130;
    cloudBlob(ctx, x, c.y, c.s, c.a);
  }
}

/**
 * Infinite rolling silhouette built from summed sines: the body colour with a
 * translucent sunlit tint laid over it.
 */
function hills(
  ctx: CanvasRenderingContext2D,
  width: number,
  offset: number,
  base: number,
  amp: number,
  freq: number,
  seed: number,
  fill: string,
  sunlit: string
): void {
  const stepX = 10;
  const heightAt = (x: number): number =>
    base -
    Math.sin((x + offset) * freq + seed) * amp -
    Math.sin((x + offset) * freq * 2.17 + seed * 2.3) * amp * 0.42 -
    Math.sin((x + offset) * freq * 0.53 + seed * 4.1) * amp * 0.78;

  ctx.beginPath();
  ctx.moveTo(-20, base + 200);
  for (let x = -20; x <= width + 20; x += stepX) ctx.lineTo(x, heightAt(x));
  ctx.lineTo(width + 20, base + 200);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.fillStyle = sunlit;
  ctx.fill();
}

/** Distant city blocks — deterministic, infinite, with faint lit windows. */
function drawSkyline(
  ctx: CanvasRenderingContext2D,
  width: number,
  offset: number,
  base: number,
  fill: string
): void {
  const cell = 74;
  const k = Math.floor(offset / cell);
  const n = Math.ceil(width / cell) + 3;

  ctx.fillStyle = fill;
  for (let i = -1; i < n; i++) {
    const idx = k + i;
    const x = idx * cell - offset;
    const w = cell * (0.42 + hash(idx * 1.7) * 0.5);
    const h = 26 + hash(idx * 3.3) * 86;
    ctx.fillRect(x, base - h, w, h + 40);
    if (hash(idx * 5.9) > 0.62) ctx.fillRect(x + w * 0.35, base - h - 16, 4, 16);
  }

  ctx.fillStyle = "rgba(255,255,255,0.10)";
  for (let i = -1; i < n; i++) {
    const idx = k + i;
    const x = idx * cell - offset;
    const w = cell * (0.42 + hash(idx * 1.7) * 0.5);
    const h = 26 + hash(idx * 3.3) * 86;
    for (let row = 0; row < Math.floor(h / 16); row++) {
      for (let col = 0; col < Math.floor(w / 13); col++) {
        if (hash(idx * 100 + row * 7 + col * 13) > 0.55) {
          ctx.fillRect(x + 5 + col * 13, base - h + 8 + row * 16, 5, 7);
        }
      }
    }
  }
}

function drawBushes(
  ctx: CanvasRenderingContext2D,
  width: number,
  offset: number,
  base: number,
  fill: string,
  dark: string
): void {
  const cell = 58;
  const k = Math.floor(offset / cell);
  const n = Math.ceil(width / cell) + 3;
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = -1; i < n; i++) {
    const idx = k + i;
    const x = idx * cell - offset + cell * 0.5;
    const r = 22 + hash(idx * 2.9) * 20;
    ctx.moveTo(x + r, base);
    ctx.arc(x, base, r, 0, Math.PI, true);
    const r2 = r * 0.72;
    ctx.moveTo(x + r * 1.15 + r2, base);
    ctx.arc(x + r * 1.15, base, r2, 0, Math.PI, true);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.fillRect(0, base - 2, width, 6);
}

/** Sky → clouds → skyline → hills → bushes, back to front. */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  state: FlappyState,
  clouds: readonly Cloud[]
): void {
  const { width, groundY, scroll } = state;
  drawSky(ctx, width, groundY);
  drawClouds(ctx, clouds, scroll, width);
  drawSkyline(ctx, width, scroll * 0.14, groundY - 68, "rgba(96,140,168,0.55)");
  hills(ctx, width, scroll * 0.2, groundY - 34, 30, 0.0042, 1.3, "#7fc4b0", "rgba(180,224,196,0.55)");
  hills(ctx, width, scroll * 0.34, groundY - 8, 22, 0.0071, 4.9, "#5aab8c", "rgba(140,206,166,0.5)");
  drawBushes(ctx, width, scroll * 0.55, groundY + 4, "#3f8f66", "#317a55");
}

/** Grass crest + scrolling dirt body with stripes and pebbles. */
export function drawGround(ctx: CanvasRenderingContext2D, state: FlappyState): void {
  const { width, height, groundY: y, scroll } = state;

  const grass = ctx.createLinearGradient(0, y, 0, y + 26);
  grass.addColorStop(0, "#9be36a");
  grass.addColorStop(0.45, "#74cc4e");
  grass.addColorStop(1, "#4fa838");
  ctx.fillStyle = grass;
  ctx.fillRect(0, y, width, 26);

  // Blades along the crest, scrolling with the world.
  const off = scroll % 16;
  ctx.fillStyle = "#b6f088";
  for (let x = -16; x < width + 16; x += 16) {
    const bx = x - off;
    ctx.beginPath();
    ctx.moveTo(bx, y + 3);
    ctx.lineTo(bx + 4, y - 5);
    ctx.lineTo(bx + 8, y + 3);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = "rgba(38,110,50,0.55)";
  ctx.fillRect(0, y + 24, width, 4);

  const dirt = ctx.createLinearGradient(0, y + 26, 0, height);
  dirt.addColorStop(0, "#e2c98d");
  dirt.addColorStop(0.35, "#d6b877");
  dirt.addColorStop(1, "#b9954f");
  ctx.fillStyle = dirt;
  ctx.fillRect(0, y + 26, width, height - y - 26 + 2);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y + 28, width, height - y - 28 + 2);
  ctx.clip();

  // Diagonal texture stripes.
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 9;
  const stripeOff = scroll % 34;
  for (let sx = -80; sx < width + 80; sx += 34) {
    ctx.beginPath();
    ctx.moveTo(sx - stripeOff, y + 26);
    ctx.lineTo(sx - stripeOff - 40, height + 4);
    ctx.stroke();
  }

  // Pebbles.
  const cell = 46;
  const k = Math.floor(scroll / cell);
  const n = Math.ceil(width / cell) + 2;
  for (let i = -1; i < n; i++) {
    const idx = k + i;
    const px = idx * cell - scroll + hash(idx * 1.1) * cell;
    const py = y + 40 + hash(idx * 4.4) * (height - y - 56);
    const pr = 2 + hash(idx * 8.8) * 3.4;
    ctx.fillStyle = "rgba(150,116,62,0.55)";
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,240,200,0.35)";
    ctx.beginPath();
    ctx.arc(px - pr * 0.3, py - pr * 0.35, pr * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.fillStyle = "rgba(0,0,0,0.10)";
  ctx.fillRect(0, y + 28, width, 3);
}
