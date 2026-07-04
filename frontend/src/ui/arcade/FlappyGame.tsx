import { useCallback, useEffect, useRef } from "react";
import { bus } from "../../game/eventBus";
import {
  initFlappy,
  flappyFlap,
  flappyTick,
  DEFAULT_FLAPPY_CONFIG,
  type FlappyState,
} from "../../game/arcade/flappy";
import type { ArcadeGameProps } from "./gameTypes";

const TICK_MS = 24;
const { width: W, height: H } = DEFAULT_FLAPPY_CONFIG;
// Internal supersample so the round bird + pipe caps stay smooth; CSS then
// scales the canvas to fill the stage.
const S = 2;
const GROUND_H = 24;

/**
 * Thin canvas renderer for the pure Flappy module. A new run remounts this
 * component (ArcadeOverlay keys it by seed), so the refs init fresh from `seed`.
 * All game rules stay in game/arcade/flappy — this only draws the returned state.
 */
export default function FlappyGame({ seed, paused, onScore, onGameOver }: ArcadeGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<FlappyState>(initFlappy(seed));
  const overRef = useRef(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const s = stateRef.current;
    ctx.setTransform(S, 0, 0, S, 0, 0);

    // Sky gradient.
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#24314a");
    sky.addColorStop(1, "#161f33");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

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

    // "Tap to start" hint before the first flap.
    if (!s.started) {
      ctx.fillStyle = "rgba(232, 236, 245, 0.85)";
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Tap / Space to fly", W / 2, H * 0.4);
    }
  }, []);

  useEffect(draw, [draw]);

  const flap = useCallback(() => {
    if (overRef.current) return;
    stateRef.current = flappyFlap(stateRef.current);
    bus.emit("arcade-flap");
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      const prev = stateRef.current;
      const next = flappyTick(prev);
      stateRef.current = next;
      if (next.score !== prev.score) {
        onScore(next.score);
        bus.emit("arcade-point");
      }
      if (!next.alive && !overRef.current) {
        overRef.current = true;
        bus.emit("arcade-over");
        onGameOver(next.score);
      }
      draw();
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [paused, draw, onScore, onGameOver]);

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
