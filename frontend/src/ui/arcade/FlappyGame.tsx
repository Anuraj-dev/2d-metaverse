import { useCallback, useEffect, useRef, useState } from "react";
import { bus } from "../../game/eventBus";
import {
  initFlappy,
  flappyFlap,
  flappyTick,
  DEFAULT_FLAPPY_CONFIG,
  type FlappyState,
} from "../../game/arcade/flappy";
import { flappyNearMiss } from "../../game/arcade/feedback";
import {
  burst,
  fadeAlpha,
  initJuice,
  popup,
  shake,
  shakeOffset,
  stepJuice,
  type JuiceState,
} from "../../game/arcade/juice";
import { getSettings } from "../settings";
import { isReducedMotion } from "../reducedMotionBridge";
import type { ArcadeGameProps } from "./gameTypes";

const TICK_MS = 24;
const { width: W, height: H } = DEFAULT_FLAPPY_CONFIG;
// Internal supersample so the round bird + pipe caps stay smooth; CSS then
// scales the canvas to fill the stage.
const S = 2;
const GROUND_H = 24;
/**
 * Reporting game-over pauses the loop and drops the overlay's card over the
 * canvas, so the death burst + shake would never be seen. Hold the run open just
 * long enough for them to read, then hand up the score.
 */
const DEATH_FREEZE_MS = 450;

/**
 * Thin canvas renderer for the pure Flappy module. A new run remounts this
 * component (ArcadeOverlay keys it by seed), so the refs init fresh from `seed`.
 * All game rules stay in game/arcade/flappy — this only draws the returned state
 * and layers the pure game/arcade/juice feedback (particles, pop-ups, shake) on
 * top. Flappy's MECHANICS are deliberately unchanged by issue #163: nothing here
 * feeds back into the reducer.
 */
export default function FlappyGame({ seed, paused, onScore, onGameOver }: ArcadeGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<FlappyState>(initFlappy(seed));
  // Juice gets its own PRNG stream seeded from the run seed, so the feedback is
  // reproducible and never perturbs the game's own randomness.
  const juiceRef = useRef<JuiceState>(initJuice(((seed ^ 0x9e3779b9) >>> 0) || 1));
  const overRef = useRef(false);
  const nearRef = useRef(false);
  const endTimerRef = useRef<number | null>(null);

  // A restart unmounts this component; never let a pending game-over land on the
  // next run.
  useEffect(
    () => () => {
      if (endTimerRef.current !== null) window.clearTimeout(endTimerRef.current);
    },
    []
  );

  // Snapshot the motion preference once per run. The overlay remounts this
  // component for every run, so a fresh run always re-reads the setting.
  const [shakeEnabled] = useState(() => getSettings().arcadeShake && !isReducedMotion());

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const s = stateRef.current;
    const j = juiceRef.current;
    ctx.setTransform(S, 0, 0, S, 0, 0);

    // Sky gradient (drawn before the shake so the backdrop never reveals edges).
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#24314a");
    sky.addColorStop(1, "#161f33");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    const off = shakeEnabled ? shakeOffset(j) : { x: 0, y: 0 };
    ctx.save();
    ctx.translate(off.x, off.y);

    // Drifting clouds (deterministic from tick — purely cosmetic).
    ctx.fillStyle = "rgba(180, 200, 230, 0.10)";
    const period = W + 60;
    for (let i = 0; i < 3; i++) {
      const cx = (((i * 110 + 30 - s.tick * 0.35) % period) + period) % period - 30;
      const cy = 34 + i * 62;
      ctx.beginPath();
      ctx.arc(cx, cy, 16, 0, Math.PI * 2);
      ctx.arc(cx + 18, cy + 4, 12, 0, Math.PI * 2);
      ctx.arc(cx - 16, cy + 4, 11, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pipes: gradient body + a lip cap + outline.
    for (const pipe of s.pipes) {
      const grad = ctx.createLinearGradient(pipe.x, 0, pipe.x + s.pipeWidth, 0);
      grad.addColorStop(0, "#6cbf76");
      grad.addColorStop(0.5, "#5aa469");
      grad.addColorStop(1, "#3f7c4e");
      ctx.fillStyle = grad;
      const botY = pipe.gapY + s.pipeGap;
      ctx.fillRect(pipe.x, 0, s.pipeWidth, pipe.gapY);
      ctx.fillRect(pipe.x, botY, s.pipeWidth, H - botY);
      // caps
      ctx.fillStyle = "#7fd08a";
      ctx.fillRect(pipe.x - 3, pipe.gapY - 12, s.pipeWidth + 6, 12);
      ctx.fillRect(pipe.x - 3, botY, s.pipeWidth + 6, 12);
      ctx.strokeStyle = "rgba(10, 20, 14, 0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(pipe.x + 0.5, 0.5, s.pipeWidth - 1, pipe.gapY - 0.5);
      ctx.strokeRect(pipe.x + 0.5, botY + 0.5, s.pipeWidth - 1, H - botY - 1);
    }

    // Ground strip.
    ctx.fillStyle = "#3a2f26";
    ctx.fillRect(0, H - GROUND_H, W, GROUND_H);
    ctx.fillStyle = "#4a7c3a";
    ctx.fillRect(0, H - GROUND_H, W, 5);

    // Bird: tilts with vertical velocity; eye, beak, wing.
    const angle = Math.max(-0.4, Math.min(0.9, s.vy * 0.06));
    ctx.save();
    ctx.translate(s.birdX, s.birdY);
    ctx.rotate(angle);
    const r = s.birdRadius;
    ctx.fillStyle = "#f2c14e";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e0a53a"; // wing
    ctx.beginPath();
    ctx.ellipse(-r * 0.2, r * 0.2, r * 0.6, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f7a23a"; // beak
    ctx.beginPath();
    ctx.moveTo(r * 0.7, -2);
    ctx.lineTo(r + 6, 0);
    ctx.lineTo(r * 0.7, 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#10141f"; // eye
    ctx.beginPath();
    ctx.arc(r * 0.35, -r * 0.35, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Particles (flap puffs, score sparks, the death burst).
    for (const p of j.particles) {
      ctx.globalAlpha = fadeAlpha(p.life, p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
    }
    ctx.globalAlpha = 1;

    // Score pop-ups.
    ctx.font = "bold 14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const u of j.popups) {
      ctx.globalAlpha = fadeAlpha(u.life, u.maxLife);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(11, 15, 24, 0.9)";
      ctx.strokeText(u.text, u.x, u.y);
      ctx.fillStyle = u.color;
      ctx.fillText(u.text, u.x, u.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // "Tap to start" hint before the first flap.
    if (!s.started) {
      ctx.fillStyle = "rgba(232, 236, 245, 0.85)";
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Tap / Space to fly", W / 2, H * 0.4);
    }
  }, [shakeEnabled]);

  useEffect(draw, [draw]);

  const flap = useCallback(() => {
    if (overRef.current) return;
    const s = stateRef.current;
    stateRef.current = flappyFlap(s);
    // A small downward puff behind the bird sells the wing beat.
    juiceRef.current = burst(juiceRef.current, {
      x: s.birdX - s.birdRadius,
      y: s.birdY + s.birdRadius * 0.5,
      count: 5,
      color: "rgba(220, 232, 250, 0.9)",
      speed: 1.6,
      life: 260,
      size: 1.6,
      direction: Math.PI / 2,
      spread: 0.7,
    });
    bus.emit("arcade-flap");
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      const prev = stateRef.current;
      const next = flappyTick(prev);
      stateRef.current = next;
      let j = juiceRef.current;

      if (next.score !== prev.score) {
        onScore(next.score);
        bus.emit("arcade-point");
        j = popup(j, { x: next.birdX, y: next.birdY - 18, text: `+1` });
        j = burst(j, {
          x: next.birdX,
          y: next.birdY,
          count: 10,
          color: "#f2c14e",
          speed: 2.4,
          life: 380,
          size: 1.8,
        });
        if (shakeEnabled) j = shake(j, 0.12);
      }

      // Near miss: edge-triggered so one squeeze blips once.
      const near = flappyNearMiss(next);
      if (near && !nearRef.current) bus.emit("arcade-near");
      nearRef.current = near;

      if (!next.alive && !overRef.current) {
        overRef.current = true;
        j = burst(j, {
          x: next.birdX,
          y: next.birdY,
          count: 24,
          color: "#f2c14e",
          speed: 4.5,
          life: 600,
          size: 2.5,
        });
        if (shakeEnabled) j = shake(j, 0.9);
        bus.emit("arcade-over");
        endTimerRef.current = window.setTimeout(() => onGameOver(next.score), DEATH_FREEZE_MS);
      }

      juiceRef.current = stepJuice(j, TICK_MS);
      draw();
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [paused, draw, onScore, onGameOver, shakeEnabled]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " && e.key !== "ArrowUp" && e.key !== "w") return;
      e.preventDefault();
      flap();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flap]);

  return (
    <canvas
      ref={canvasRef}
      className="arcade-canvas"
      width={W * S}
      height={H * S}
      onPointerDown={flap}
    />
  );
}
