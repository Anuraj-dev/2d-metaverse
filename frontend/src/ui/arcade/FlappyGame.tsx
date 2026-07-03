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

/**
 * Thin canvas renderer for the pure Flappy module. A new run remounts this
 * component (ArcadeOverlay keys it by seed), so the refs init fresh from `seed`.
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
    ctx.fillStyle = "#1b2438";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#5aa469";
    for (const pipe of s.pipes) {
      ctx.fillRect(pipe.x, 0, s.pipeWidth, pipe.gapY);
      ctx.fillRect(pipe.x, pipe.gapY + s.pipeGap, s.pipeWidth, H - (pipe.gapY + s.pipeGap));
    }
    ctx.fillStyle = "#f2c14e";
    ctx.beginPath();
    ctx.arc(s.birdX, s.birdY, s.birdRadius, 0, Math.PI * 2);
    ctx.fill();
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
      width={W}
      height={H}
      onPointerDown={flap}
    />
  );
}
