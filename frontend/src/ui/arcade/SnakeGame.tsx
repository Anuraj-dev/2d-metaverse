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

// Internal render resolution (CSS scales the canvas up crisply to fill the
// stage). Larger cells than the world tile give room for rounded segments +
// eyes without touching the pure game module.
const CELL = 24;
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

const EYE_OFFSET: Record<Dir, [number, number][]> = {
  up: [[0.3, 0.32], [0.7, 0.32]],
  down: [[0.3, 0.68], [0.7, 0.68]],
  left: [[0.32, 0.3], [0.32, 0.7]],
  right: [[0.68, 0.3], [0.68, 0.7]],
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}

/**
 * Thin canvas renderer for the pure Snake module. A new run remounts this
 * component (ArcadeOverlay keys it by seed), so the refs init fresh from `seed`.
 * All game rules stay in game/arcade/snake — this only draws the returned state.
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
    const { width, height } = canvas;

    // Playfield backdrop + subtle checker so motion reads clearly.
    ctx.fillStyle = "#0b0f18";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(127, 209, 185, 0.04)";
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        if ((x + y) % 2 === 0) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }

    // Food: a glowing pink pellet.
    ctx.save();
    ctx.shadowColor = "#e0567a";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#e0567a";
    roundRect(ctx, s.food.x * CELL + 4, s.food.y * CELL + 4, CELL - 8, CELL - 8, 5);
    ctx.restore();

    // Snake: rounded segments fading head→tail; the head carries two eyes.
    const n = s.body.length;
    s.body.forEach((c, i) => {
      const t = n > 1 ? i / (n - 1) : 0;
      const head = i === 0;
      ctx.fillStyle = head ? "#8ff0d6" : `rgb(${74 - t * 20}, ${157 - t * 40}, ${142 - t * 30})`;
      roundRect(ctx, c.x * CELL + 1.5, c.y * CELL + 1.5, CELL - 3, CELL - 3, 6);
      if (head) {
        ctx.fillStyle = "#0b0f18";
        for (const [ex, ey] of EYE_OFFSET[s.dir]) {
          ctx.beginPath();
          ctx.arc(c.x * CELL + ex * CELL, c.y * CELL + ey * CELL, CELL * 0.09, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });

    // Frame.
    ctx.strokeStyle = "#1d2740";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, width - 2, height - 2);
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
