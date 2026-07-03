import { useCallback, useEffect, useRef } from "react";
import { bus } from "../../game/eventBus";
import {
  initSnake,
  snakeInput,
  snakeTick,
  DEFAULT_SNAKE_WIDTH,
  DEFAULT_SNAKE_HEIGHT,
  type Dir,
  type SnakeState,
} from "../../game/arcade/snake";
import type { ArcadeGameProps } from "./gameTypes";

const CELL = 18;
const TICK_MS = 110;

const KEY_DIR: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
  W: "up",
  S: "down",
  A: "left",
  D: "right",
};

/**
 * Thin canvas renderer for the pure Snake module. A new run remounts this
 * component (ArcadeOverlay keys it by seed), so the refs init fresh from `seed`.
 */
export default function SnakeGame({ seed, paused, onScore, onGameOver }: ArcadeGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<SnakeState>(initSnake(seed));
  const overRef = useRef(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const s = stateRef.current;
    ctx.fillStyle = "#10141f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e0567a";
    ctx.fillRect(s.food.x * CELL + 2, s.food.y * CELL + 2, CELL - 4, CELL - 4);
    s.body.forEach((c, i) => {
      ctx.fillStyle = i === 0 ? "#7fd1b9" : "#4a9d8e";
      ctx.fillRect(c.x * CELL + 1, c.y * CELL + 1, CELL - 2, CELL - 2);
    });
  }, []);

  // Paint the initial frame once mounted.
  useEffect(draw, [draw]);

  // Game loop.
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      const prev = stateRef.current;
      const next = snakeTick(prev);
      stateRef.current = next;
      if (next.score !== prev.score) {
        onScore(next.score);
        bus.emit("arcade-point");
      }
      // Terminal states: death or a full-board win both end the run.
      if ((!next.alive || next.won) && !overRef.current) {
        overRef.current = true;
        bus.emit("arcade-over");
        onGameOver(next.score);
      }
      draw();
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [paused, draw, onScore, onGameOver]);

  // Keyboard: window-level so a stale focused input can't swallow it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = KEY_DIR[e.key];
      if (!dir) return;
      e.preventDefault();
      stateRef.current = snakeInput(stateRef.current, dir);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="arcade-canvas"
      width={DEFAULT_SNAKE_WIDTH * CELL}
      height={DEFAULT_SNAKE_HEIGHT * CELL}
    />
  );
}
