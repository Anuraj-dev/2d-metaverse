import { useCallback, useEffect, useRef, useState } from "react";
import { bus } from "../../game/eventBus";
import {
  initSnake,
  snakeInput,
  snakeLevelById,
  snakeSpeedById,
  snakeTick,
  type Dir,
  type SnakeState,
} from "../../game/arcade/snake";
import { snakeNearMiss } from "../../game/arcade/feedback";
import {
  FOOD_TILE,
  SNAKE_SHEET_URL,
  SNAKE_TILE_PX,
  WALL_TILE,
  snakeTileIndex,
} from "../../game/arcade/snakeSprites";
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

/** Render cell size: exactly 2x the 16px sprite tile, so scaling stays crisp. */
const CELL = SNAKE_TILE_PX * 2;
/** Frame cadence for juice + drawing; the reducer ticks on the level's own cadence. */
const FRAME_MS = 16;
/**
 * Reporting game-over pauses the loop and drops the overlay's card over the
 * canvas, so the death burst + shake would never be seen. Hold the run open just
 * long enough for them to read, then hand up the score.
 */
const DEATH_FREEZE_MS = 450;

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
 * The sprite sheet is shared across mounts (a run restart remounts this
 * component) so a restart never re-requests it. Absent in non-DOM test
 * environments — the renderer falls back to plain shapes until it decodes.
 */
let sheetImage: HTMLImageElement | null = null;
function snakeSheet(): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  if (!sheetImage) {
    sheetImage = new Image();
    sheetImage.src = SNAKE_SHEET_URL;
  }
  return sheetImage;
}

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
 * component (ArcadeOverlay keys it by seed), so the refs init fresh from `seed`
 * AND from the persisted level/speed/shake settings — which is why changing an
 * option in the overlay bumps the seed.
 *
 * All game rules stay in game/arcade/snake; the level layout and tick cadence
 * are data from that module; the particles/pop-ups/shake are the pure
 * game/arcade/juice reducer. This file only draws and wires input, and it stays
 * audio-agnostic: it emits domain events on the bus and the sound mixer decides
 * the clip.
 */
export default function SnakeGame({ seed, paused, onScore, onGameOver }: ArcadeGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Snapshot the options once per run so a mid-run settings change cannot
  // reshape the board under the player. The overlay remounts this component for
  // every run (it keys the game by seed), so a fresh run always re-reads them.
  const [options] = useState(() => {
    const s = getSettings();
    return {
      level: snakeLevelById(s.snakeLevel),
      tickMs: snakeSpeedById(s.snakeSpeed).tickMs,
      shakeEnabled: s.arcadeShake && !isReducedMotion(),
      reduced: isReducedMotion(),
    };
  });

  const stateRef = useRef<SnakeState>(initSnake(seed, options.level));
  // Juice gets its own PRNG stream seeded from the run seed, so the feedback is
  // as reproducible as the game itself and never touches the game's own seed.
  const juiceRef = useRef<JuiceState>(initJuice(((seed ^ 0x9e3779b9) >>> 0) || 1));
  const overRef = useRef(false);
  const nearRef = useRef(false);
  const accRef = useRef(0);
  const endTimerRef = useRef<number | null>(null);

  // A restart unmounts this component; never let a pending game-over land on the
  // next run.
  useEffect(
    () => () => {
      if (endTimerRef.current !== null) window.clearTimeout(endTimerRef.current);
    },
    []
  );

  const centre = useCallback(
    (c: { x: number; y: number }) => ({ x: c.x * CELL + CELL / 2, y: c.y * CELL + CELL / 2 }),
    []
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const s = stateRef.current;
    const j = juiceRef.current;
    const { width, height } = canvas;
    const sheet = snakeSheet();
    const ready = !!sheet && sheet.complete && sheet.naturalWidth > 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // Playfield backdrop + subtle checker so motion reads clearly.
    ctx.fillStyle = "#0b0f18";
    ctx.fillRect(0, 0, width, height);

    const off = options.shakeEnabled ? shakeOffset(j) : { x: 0, y: 0 };
    ctx.save();
    ctx.translate(off.x, off.y);

    ctx.fillStyle = "rgba(127, 209, 185, 0.04)";
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        if ((x + y) % 2 === 0) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }

    const tile = (index: number, cx: number, cy: number, size = CELL) => {
      if (!ready || !sheet) return false;
      const inset = (CELL - size) / 2;
      ctx.drawImage(
        sheet,
        index * SNAKE_TILE_PX,
        0,
        SNAKE_TILE_PX,
        SNAKE_TILE_PX,
        cx * CELL + inset,
        cy * CELL + inset,
        size,
        size
      );
      return true;
    };

    // Level walls.
    for (const w of s.walls) {
      if (!tile(WALL_TILE, w.x, w.y)) {
        ctx.fillStyle = "#3a4767";
        ctx.fillRect(w.x * CELL, w.y * CELL, CELL, CELL);
      }
    }

    // Food, with a gentle breathing pulse (skipped under reduced motion).
    const pulse = options.reduced ? 1 : 1 + 0.07 * Math.sin(j.elapsedMs / 180);
    ctx.save();
    ctx.shadowColor = "#e0567a";
    ctx.shadowBlur = 10;
    if (!tile(FOOD_TILE, s.food.x, s.food.y, CELL * pulse)) {
      ctx.fillStyle = "#e0567a";
      roundRect(ctx, s.food.x * CELL + 6, s.food.y * CELL + 6, CELL - 12, CELL - 12, 6);
    }
    ctx.restore();

    // Snake: one sprite tile per segment, chosen from its neighbours.
    s.body.forEach((c, i) => {
      if (tile(snakeTileIndex(s.body, i, s.dir), c.x, c.y)) return;
      // Fallback while the sheet decodes: the pre-#163 rounded segments.
      const n = s.body.length;
      const t = n > 1 ? i / (n - 1) : 0;
      ctx.fillStyle =
        i === 0 ? "#8ff0d6" : `rgb(${74 - t * 20}, ${157 - t * 40}, ${142 - t * 30})`;
      roundRect(ctx, c.x * CELL + 2, c.y * CELL + 2, CELL - 4, CELL - 4, 8);
    });

    // Particles.
    for (const p of j.particles) {
      ctx.globalAlpha = fadeAlpha(p.life, p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
    }
    ctx.globalAlpha = 1;

    // Score pop-ups.
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const u of j.popups) {
      ctx.globalAlpha = fadeAlpha(u.life, u.maxLife);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(11, 15, 24, 0.9)";
      ctx.strokeText(u.text, u.x, u.y);
      ctx.fillStyle = u.color;
      ctx.fillText(u.text, u.x, u.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Frame.
    ctx.strokeStyle = "#1d2740";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, width - 2, height - 2);
  }, [options]);

  // Paint the initial frame once mounted, and again when the sheet decodes.
  useEffect(() => {
    draw();
    const sheet = snakeSheet();
    if (!sheet || sheet.complete) return;
    sheet.addEventListener("load", draw);
    return () => sheet.removeEventListener("load", draw);
  }, [draw]);

  // Game loop: fixed-cadence reducer ticks, per-frame juice + repaint.
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      accRef.current += FRAME_MS;
      while (accRef.current >= options.tickMs) {
        accRef.current -= options.tickMs;
        const prev = stateRef.current;
        const next = snakeTick(prev);
        stateRef.current = next;
        let j = juiceRef.current;

        if (next.score !== prev.score) {
          // Eating is Snake's score event; it gets its own cue (issue #163).
          onScore(next.score);
          bus.emit("arcade-eat");
          const at = centre(prev.food);
          j = burst(j, {
            x: at.x,
            y: at.y,
            count: 14,
            color: "#e0567a",
            speed: 3.4,
            life: 420,
            size: 2.5,
          });
          j = popup(j, { x: at.x, y: at.y - 6, text: "+1" });
          if (options.shakeEnabled) j = shake(j, 0.16);
        }

        // Near miss: edge-triggered so threading a long corridor blips once.
        const near = snakeNearMiss(next);
        if (near && !nearRef.current) bus.emit("arcade-near");
        nearRef.current = near;

        // Terminal states: death or a full-board win both end the run.
        if ((!next.alive || next.won) && !overRef.current) {
          overRef.current = true;
          const head = next.body[0];
          if (head) {
            const at = centre(head);
            j = burst(j, {
              x: at.x,
              y: at.y,
              count: 26,
              color: next.won ? "#f2c14e" : "#8ff0d6",
              speed: 5,
              life: 620,
              size: 3,
            });
          }
          if (options.shakeEnabled) j = shake(j, next.won ? 0.4 : 0.9);
          bus.emit("arcade-over");
          endTimerRef.current = window.setTimeout(
            () => onGameOver(next.score),
            DEATH_FREEZE_MS
          );
        }
        juiceRef.current = j;
      }
      juiceRef.current = stepJuice(juiceRef.current, FRAME_MS);
      draw();
    }, FRAME_MS);
    return () => window.clearInterval(id);
  }, [paused, draw, onScore, onGameOver, options, centre]);

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
      width={options.level.width * CELL}
      height={options.level.height * CELL}
    />
  );
}
