import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { bus } from "../../game/eventBus";
import { nextFloat } from "../../game/arcade/prng";
import {
  initMergeDrop,
  stepMergeDrop,
  tierAt,
  DEFAULT_MERGE_DROP_CONFIG,
  MAX_TIER,
  MERGE_DROP_TIERS,
  phaseFor,
  type MergeBody,
  type MergeDropInput,
  type MergeDropState,
} from "../../game/arcade/mergedrop";
import type { ArcadeGameProps } from "./gameTypes";

const TICK_MS = 16;
const CFG = DEFAULT_MERGE_DROP_CONFIG;

// ── Canvas layout (logical units; `S` supersamples, CSS scales to the stage) ──
const W = 420;
const H = 520;
const S = 2;
const WELL_X = 80;
const WELL_Y = 48;
const LADDER_Y = 490;
const LADDER_STEP = 42;
const POP_TICKS = 18;
/** Ticks of aim travel granted by a single arrow-key tap (see the key handler). */
const TAP_TICKS = 9;

/** Wobble/pop envelope for a body that was just fused (1 → 0 over POP_TICKS). */
function popPhase(body: MergeBody, tick: number): number {
  if (!body.fused) return 0;
  const age = tick - body.bornTick;
  if (age < 0 || age >= POP_TICKS) return 0;
  return 1 - age / POP_TICKS;
}

/** Stable per-body pseudo-random in [0,1) — surface detail must not shimmer. */
function detail(id: number, salt: number): number {
  return nextFloat(((id * 2654435761 + salt * 40503) >>> 0) || 1).value;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

/**
 * Stellar Forge — the canvas surface for the pure merge-drop reducer.
 *
 * Thin by contract: it collects input, runs `stepMergeDrop` on a fixed tick,
 * draws the returned state, and reports score/game-over upward. Every rule
 * (physics, merging, scoring, overflow) lives in game/arcade/mergedrop. The
 * only state owned here is presentation: particles, screen shake and the
 * chain banner, all driven by the reducer's domain events. Sound is emitted as
 * domain events on the bus — the mixer's event→clip table picks the blip.
 */
export default function MergeDropGame({ seed, paused, onScore, onGameOver }: ArcadeGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<MergeDropState>(initMergeDrop(seed));
  const overRef = useRef(false);

  // Input, sampled once per tick.
  const moveRef = useRef<-1 | 0 | 1>(0);
  const heldRef = useRef({ left: false, right: false });
  const tapRef = useRef<{ dir: -1 | 0 | 1; ticks: number }>({ dir: 0, ticks: 0 });
  const dropRef = useRef(false);
  const aimRef = useRef<number | null>(null);

  // Presentation-only state (never feeds back into the reducer).
  const particlesRef = useRef<Particle[]>([]);
  const fxSeedRef = useRef(((seed * 2246822519) >>> 0) || 1);
  const shakeRef = useRef(0);
  const flashRef = useRef(0);
  const bannerRef = useRef<{ text: string; life: number }>({ text: "", life: 0 });

  const fxRandom = useCallback((): number => {
    const { value, seed: next } = nextFloat(fxSeedRef.current);
    fxSeedRef.current = next;
    return value;
  }, []);

  const burst = useCallback(
    (x: number, y: number, count: number, spread: number, colors: readonly string[]) => {
      const list = particlesRef.current;
      for (let i = 0; i < count; i++) {
        const angle = fxRandom() * Math.PI * 2;
        const speed = spread * (0.35 + fxRandom() * 0.8);
        const life = 30 + Math.floor(fxRandom() * 30);
        list.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - spread * 0.25,
          life,
          max: life,
          size: 1.2 + fxRandom() * 2.6,
          color: colors[Math.floor(fxRandom() * colors.length)] ?? "#ffffff",
        });
      }
      // Hard cap so a long chain can never grow the particle list unbounded.
      if (list.length > 420) list.splice(0, list.length - 420);
    },
    [fxRandom]
  );

  // ── Drawing ────────────────────────────────────────────────────────────────

  const drawStarfield = useCallback((ctx: CanvasRenderingContext2D, tick: number) => {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#0a0d1a");
    sky.addColorStop(0.55, "#101733");
    sky.addColorStop(1, "#070a14");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Two soft nebulae for depth.
    for (const [nx, ny, nr, tint] of [
      [90, 150, 190, "rgba(126, 90, 220, 0.16)"],
      [330, 400, 220, "rgba(60, 160, 200, 0.13)"],
    ] as const) {
      const neb = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
      neb.addColorStop(0, tint);
      neb.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = neb;
      ctx.fillRect(0, 0, W, H);
    }

    // Three parallax star layers, deterministic from a fixed hash.
    for (let layer = 0; layer < 3; layer++) {
      const count = 34 - layer * 8;
      const drift = tick * (0.03 + layer * 0.035);
      ctx.fillStyle = `rgba(226, 234, 255, ${0.24 + layer * 0.22})`;
      for (let i = 0; i < count; i++) {
        const sx = detail(i + layer * 97 + 1, 3) * W;
        const sy = (detail(i + layer * 97 + 1, 11) * H + drift) % H;
        const size = 0.6 + layer * 0.5;
        ctx.fillRect(sx, sy, size, size);
      }
    }
  }, []);

  const drawBody = useCallback(
    (ctx: CanvasRenderingContext2D, body: MergeBody, tick: number, cx: number, cy: number) => {
      const rung = tierAt(body.tier);
      const pop = popPhase(body, tick);
      // Squash-and-stretch on the pop, then a slow idle wobble for gas/stars.
      const wob = 1 + Math.sin(tick * 0.09 + body.id) * 0.012 * (body.tier >= 6 ? 1 : 0.4);
      const sx = (1 + pop * 0.34) * wob;
      const sy = (1 - pop * 0.2) / wob;
      const r = body.r;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(sx, sy);

      // Outer glow — brighter for the high rungs and while popping.
      const glow = ctx.createRadialGradient(0, 0, r * 0.7, 0, 0, r * (1.55 + pop * 0.5));
      glow.addColorStop(0, `${rung.light}55`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.35 + pop * 0.5 + body.tier * 0.05;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, r * (1.55 + pop * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Sphere: lit from the upper left, terminator on the lower right.
      const sphere = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
      sphere.addColorStop(0, rung.light);
      sphere.addColorStop(0.45, rung.color);
      sphere.addColorStop(1, rung.shade);
      ctx.fillStyle = sphere;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      // Surface detail per family — all deterministic from the body id.
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.clip();
      if (body.tier <= 2) {
        ctx.fillStyle = rung.shade;
        ctx.globalAlpha = 0.55;
        for (let i = 0; i < 3; i++) {
          const a = detail(body.id, i) * Math.PI * 2;
          const d = detail(body.id, i + 30) * r * 0.6;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * (0.12 + detail(body.id, i + 60) * 0.14), 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (body.tier === 3) {
        // Comet: an icy tail streaming up-right.
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = rung.light;
        ctx.lineWidth = r * 0.3;
        ctx.beginPath();
        ctx.moveTo(-r, r * 0.5);
        ctx.lineTo(r * 0.8, -r * 0.7);
        ctx.stroke();
      } else if (body.tier <= 5) {
        // Moon craters / continents.
        ctx.fillStyle = body.tier === 5 ? "#2f7f52" : rung.shade;
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < 5; i++) {
          const a = detail(body.id, i + 5) * Math.PI * 2;
          const d = detail(body.id, i + 40) * r * 0.65;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * (0.1 + detail(body.id, i + 70) * 0.18), 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (body.tier <= 7) {
        // Gas bands.
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = rung.shade;
        for (let i = -3; i <= 3; i++) {
          const by = (i / 3.4) * r;
          const bh = r * (0.09 + detail(body.id, i + 90) * 0.08);
          ctx.fillRect(-r, by, r * 2, bh);
        }
      } else {
        // Stars: a churning bright core.
        ctx.globalAlpha = 0.6;
        const core = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.85);
        core.addColorStop(0, "#fffdf3");
        core.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Ring for the gas giant, corona for the sun.
      if (body.tier === 7) {
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = rung.light;
        ctx.lineWidth = Math.max(1.5, r * 0.08);
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.45, r * 0.38, -0.35, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (body.tier === MAX_TIER) {
        ctx.globalAlpha = 0.35 + Math.sin(tick * 0.12) * 0.12;
        ctx.strokeStyle = rung.light;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.12, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Rim light + specular highlight.
      ctx.strokeStyle = `${rung.light}88`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, r - 0.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.ellipse(-r * 0.38, -r * 0.44, r * 0.2, r * 0.13, -0.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    },
    []
  );

  const drawPanels = useCallback((ctx: CanvasRenderingContext2D, s: MergeDropState) => {
    ctx.textAlign = "center";

    // NEXT preview (left column).
    ctx.font = "9px system-ui, sans-serif";
    ctx.fillStyle = "rgba(180, 194, 224, 0.75)";
    ctx.fillText("NEXT", 40, 66);
    ctx.fillStyle = "rgba(14, 20, 36, 0.7)";
    ctx.strokeStyle = "rgba(120, 140, 190, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(10, 72, 60, 60, 8);
    ctx.fill();
    ctx.stroke();
    const nextRung = tierAt(s.next);
    const preview = ctx.createRadialGradient(34, 96, 2, 40, 102, 20);
    preview.addColorStop(0, nextRung.light);
    preview.addColorStop(0.5, nextRung.color);
    preview.addColorStop(1, nextRung.shade);
    ctx.fillStyle = preview;
    ctx.beginPath();
    ctx.arc(40, 102, Math.min(20, nextRung.radius), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(200, 212, 238, 0.7)";
    ctx.font = "8px system-ui, sans-serif";
    ctx.fillText(nextRung.name, 40, 146);

    // Chain banner (left column, under the preview).
    const banner = bannerRef.current;
    if (banner.life > 0) {
      ctx.globalAlpha = Math.min(1, banner.life / 20);
      ctx.fillStyle = "#ffd166";
      // 11px keeps the longest banner ("SUPERNOVA") inside the 80px-wide left
      // column instead of spilling over the well wall.
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.fillText(banner.text, 40, 182);
      ctx.globalAlpha = 1;
    }

    // Supernova tally.
    if (s.novas > 0) {
      ctx.fillStyle = "rgba(255, 176, 120, 0.85)";
      ctx.font = "9px system-ui, sans-serif";
      ctx.fillText(`${s.novas}x NOVA`, 40, 212);
    }

    // Heat meter (right column): how full the well is, so it reads live from the
    // first drop; it goes red and pulses only once a body is actually overflowing.
    const critical = s.danger > 0;
    ctx.fillStyle = critical ? "#ff4d5e" : "rgba(180, 194, 224, 0.75)";
    ctx.font = "9px system-ui, sans-serif";
    ctx.fillText("HEAT", 380, 66);
    const meterY = 76;
    const meterH = 190;
    ctx.fillStyle = "rgba(14, 20, 36, 0.7)";
    ctx.strokeStyle = critical ? "rgba(255, 77, 94, 0.7)" : "rgba(120, 140, 190, 0.35)";
    ctx.beginPath();
    ctx.roundRect(368, meterY, 24, meterH, 6);
    ctx.fill();
    ctx.stroke();
    const level = Math.max(s.stackHeight, s.danger);
    const fill = meterH * level;
    if (fill > 0.5) {
      const grad = ctx.createLinearGradient(0, meterY + meterH, 0, meterY);
      grad.addColorStop(0, "#7ee8fa");
      grad.addColorStop(0.6, "#ffd166");
      grad.addColorStop(1, "#ff4d5e");
      ctx.globalAlpha = critical ? 0.7 + Math.sin(s.tick * 0.2) * 0.3 : 1;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(370, meterY + meterH - fill, 20, fill, 5);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Highest rung reached.
    ctx.fillStyle = "rgba(180, 194, 224, 0.75)";
    ctx.font = "9px system-ui, sans-serif";
    ctx.fillText("BEST", 380, 296);
    ctx.fillStyle = tierAt(s.best).light;
    ctx.font = "bold 9px system-ui, sans-serif";
    for (const [i, word] of tierAt(s.best).name.split(" ").entries()) {
      ctx.fillText(word, 380, 312 + i * 12);
    }

    // Evolution ladder along the bottom.
    for (let i = 0; i < MERGE_DROP_TIERS.length; i++) {
      const rung = tierAt(i);
      const x = 21 + i * LADDER_STEP;
      const r = 3.5 + i * 0.95;
      const reached = i <= s.best;
      ctx.globalAlpha = reached ? 1 : 0.28;
      const g = ctx.createRadialGradient(x - r * 0.3, LADDER_Y - r * 0.3, 0, x, LADDER_Y, r);
      g.addColorStop(0, rung.light);
      g.addColorStop(1, reached ? rung.color : rung.shade);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, LADDER_Y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = reached ? "rgba(226, 234, 255, 0.9)" : "rgba(160, 172, 200, 0.7)";
      ctx.font = "6px system-ui, sans-serif";
      ctx.fillText(rung.name.toUpperCase(), x, LADDER_Y + 16);
      ctx.globalAlpha = 1;
      if (i < MERGE_DROP_TIERS.length - 1) {
        ctx.strokeStyle = "rgba(140, 156, 200, 0.25)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + r + 3, LADDER_Y);
        ctx.lineTo(x + LADDER_STEP - (3.5 + (i + 1) * 0.95) - 3, LADDER_Y);
        ctx.stroke();
      }
    }
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const s = stateRef.current;
    const tick = s.tick;

    const shake = shakeRef.current;
    const ox = shake > 0 ? (fxRandom() - 0.5) * shake : 0;
    const oy = shake > 0 ? (fxRandom() - 0.5) * shake : 0;
    ctx.setTransform(S, 0, 0, S, ox * S, oy * S);

    drawStarfield(ctx, tick);

    // Well shell.
    ctx.fillStyle = "rgba(8, 12, 22, 0.72)";
    ctx.beginPath();
    ctx.roundRect(WELL_X - 4, WELL_Y - 4, CFG.width + 8, CFG.height + 8, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(126, 232, 250, 0.45)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Everything inside the well is clipped to it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(WELL_X, WELL_Y, CFG.width, CFG.height);
    ctx.clip();

    // Danger line: pulses harder as the heat meter fills.
    const dangerY = WELL_Y + CFG.dangerY;
    const pulse = 0.35 + s.danger * 0.5 + Math.sin(tick * 0.14) * (0.12 + s.danger * 0.2);
    ctx.globalAlpha = Math.max(0.15, Math.min(1, pulse));
    ctx.strokeStyle = s.danger > 0 ? "#ff4d5e" : "#ffd166";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.moveTo(WELL_X, dangerY);
    ctx.lineTo(WELL_X + CFG.width, dangerY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Drop guide from the held body down to the floor. Once the phase's
    // forced-drop deadline nears, the guide turns amber and pulses — the
    // auto-drop must never feel like it came from nowhere.
    const holdX = WELL_X + s.aimX;
    const deadline = phaseFor(s.tick).autoDropTicks;
    const urgency = Math.min(1, (s.tick - s.lastDropTick) / deadline);
    if (urgency > 0.7 && !s.over) {
      ctx.globalAlpha = 0.22 + (urgency - 0.7) * (1.7 + Math.sin(tick * 0.3));
      ctx.strokeStyle = "#ffd166";
    } else {
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = "#7ee8fa";
    }
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(holdX, WELL_Y + CFG.holdY);
    ctx.lineTo(holdX, WELL_Y + CFG.height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    for (const body of s.bodies) {
      drawBody(ctx, body, tick, WELL_X + body.x, WELL_Y + body.y);
    }

    // The held body, bobbing gently while it waits.
    if (!s.over) {
      const held: MergeBody = {
        id: 0,
        tier: s.current,
        x: s.aimX,
        y: CFG.holdY,
        px: s.aimX,
        py: CFG.holdY,
        r: tierAt(s.current).radius,
        bornTick: -1,
        fused: false,
        aboveTicks: 0,
      };
      ctx.globalAlpha = s.dropCooldown > 0 ? 0.5 : 1;
      drawBody(ctx, held, tick, holdX, WELL_Y + CFG.holdY + Math.sin(tick * 0.1) * 1.6);
      ctx.globalAlpha = 1;
    }

    // Particles (additive, so bursts read as light).
    ctx.globalCompositeOperation = "lighter";
    for (const p of particlesRef.current) {
      ctx.globalAlpha = Math.max(0, p.life / p.max) * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    ctx.restore();

    drawPanels(ctx, s);

    // Supernova whiteout.
    if (flashRef.current > 0) {
      ctx.fillStyle = `rgba(255, 244, 214, ${Math.min(0.6, flashRef.current / 30)})`;
      ctx.fillRect(0, 0, W, H);
    }

    // First-run hint.
    if (s.tick < 240 && s.bodies.length === 0) {
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(226, 234, 255, 0.8)";
      ctx.font = "11px system-ui, sans-serif";
      // Kept short so the line stays inside the well's 260px width.
      ctx.fillText("← → or mouse to aim · Space to drop", W / 2, H - 62);
    }
  }, [drawBody, drawPanels, drawStarfield, fxRandom]);

  useEffect(draw, [draw]);

  // ── Tick loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      const prev = stateRef.current;
      // A physically-held key wins; otherwise spend any latched tap ticks.
      const held = moveRef.current;
      const tap = tapRef.current;
      let move: -1 | 0 | 1 = held;
      if (held !== 0) tap.ticks = 0;
      else if (tap.ticks > 0) {
        move = tap.dir;
        tap.ticks -= 1;
      }
      const input: MergeDropInput = {
        move,
        aimTo: aimRef.current,
        drop: dropRef.current,
      };
      dropRef.current = false;
      aimRef.current = null;
      const next = prev.over ? prev : stepMergeDrop(prev, input);
      stateRef.current = next;

      for (const event of next.events) {
        if (event.type === "merge") {
          const rung = tierAt(event.tier);
          burst(WELL_X + event.x, WELL_Y + event.y, 10 + event.tier * 3, 1.4 + event.tier * 0.25, [
            rung.light,
            rung.color,
            "#ffffff",
          ]);
          shakeRef.current = Math.max(shakeRef.current, 0.6 + event.tier * 0.45);
          if (event.chain > 1) bannerRef.current = { text: `CHAIN x${event.chain}`, life: 46 };
          // Audio-agnostic: the mixer maps this to a clip and pitches it by tier.
          bus.emit("arcade-merge", { tier: event.tier });
        } else if (event.type === "nova") {
          burst(WELL_X + event.x, WELL_Y + event.y, 90, 5.5, ["#fff4d6", "#ffd166", "#ff7b00", "#ff4d5e"]);
          shakeRef.current = 9;
          flashRef.current = 30;
          bannerRef.current = { text: "SUPERNOVA", life: 70 };
          bus.emit("arcade-nova", { tier: MAX_TIER });
        } else if (event.type === "drop") {
          bus.emit("arcade-drop", { tier: event.tier });
        }
      }

      // Presentation decay.
      const alive: Particle[] = [];
      for (const p of particlesRef.current) {
        p.life -= 1;
        if (p.life <= 0) continue;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.09;
        p.vx *= 0.985;
        alive.push(p);
      }
      particlesRef.current = alive;
      shakeRef.current = shakeRef.current > 0.05 ? shakeRef.current * 0.86 : 0;
      flashRef.current = Math.max(0, flashRef.current - 1);
      if (bannerRef.current.life > 0) bannerRef.current.life -= 1;

      if (next.score !== prev.score) onScore(next.score);
      if (next.over && !overRef.current) {
        overRef.current = true;
        bus.emit("arcade-over");
        onGameOver(next.score);
      }
      draw();
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [paused, draw, burst, onScore, onGameOver]);

  // ── Keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const axis = () => (heldRef.current.left === heldRef.current.right ? 0 : heldRef.current.left ? -1 : 1);
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      let dir: -1 | 0 | 1 = 0;
      if (key === "arrowleft" || key === "a") {
        heldRef.current.left = true;
        dir = -1;
      } else if (key === "arrowright" || key === "d") {
        heldRef.current.right = true;
        dir = 1;
      } else if (key === " " || key === "arrowdown" || key === "s" || key === "enter") {
        dropRef.current = true;
      } else return;
      e.preventDefault();
      // A *tap* can begin and end inside one 16ms tick, which would sample an
      // axis of 0 and move the aim nowhere. Latch the direction for a few ticks
      // so a tap is always a visible nudge; holding the key overrides it below.
      if (dir !== 0) tapRef.current = { dir, ticks: TAP_TICKS };
      moveRef.current = axis();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "arrowleft" || key === "a") heldRef.current.left = false;
      else if (key === "arrowright" || key === "d") heldRef.current.right = false;
      else return;
      moveRef.current = axis();
    };
    // Losing focus mid-hold must not leave the aim stuck travelling.
    const onBlur = () => {
      heldRef.current = { left: false, right: false };
      moveRef.current = 0;
      tapRef.current = { dir: 0, ticks: 0 };
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // ── Pointer ────────────────────────────────────────────────────────────────
  // The canvas is letterboxed by `object-fit: contain`, so map client x through
  // the drawn content box rather than the element box.
  const wellXFromClient = useCallback((clientX: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const scale = Math.min(rect.width / W, rect.height / H);
    const left = rect.left + (rect.width - W * scale) / 2;
    return (clientX - left) / scale - WELL_X;
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      aimRef.current = wellXFromClient(e.clientX);
    },
    [wellXFromClient]
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      aimRef.current = wellXFromClient(e.clientX);
      dropRef.current = true;
    },
    [wellXFromClient]
  );

  return (
    <canvas
      ref={canvasRef}
      className="arcade-canvas"
      width={W * S}
      height={H * S}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
    />
  );
}
