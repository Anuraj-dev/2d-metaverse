import { useCallback, useEffect, useRef } from "react";
import { bus } from "../../game/eventBus";
import {
  initFlappy,
  flappyFlap,
  flappyTick,
  flappyResize,
  DEFAULT_FLAPPY_CONFIG,
  FLAPPY_STEP,
  type FlappyState,
} from "../../game/arcade/flappy";
import { buildClouds, type Cloud } from "./flappy/scenery";
import { createFx, stepFx, hitFx, emitFlapPuff, type FlappyFx } from "./flappy/fx";
import { renderFlappy } from "./flappy/render";
import type { ArcadeGameProps } from "./gameTypes";

const {
  width: BASE_W,
  height: BASE_H,
  groundHeight: GROUND_H,
  minWidth: MIN_W,
  maxWidth: MAX_W,
} = DEFAULT_FLAPPY_CONFIG;
/** Cap the backing store so a huge screen does not cost a huge fill rate. */
const MAX_DPR = 2;
/** Never advance more than this much simulated time in one frame. */
const MAX_FRAME_SECONDS = 0.25;
const MAX_STEPS_PER_FRAME = 60;

/**
 * Thin canvas renderer for the pure Flappy module. A new run remounts this
 * component (ArcadeOverlay keys it by seed), so the refs init fresh from `seed`.
 * All game rules stay in game/arcade/flappy — this drives the fixed-step loop,
 * feeds inputs in, draws the returned state (art modules under ./flappy), and
 * reports score/game-over upward. Sounds are domain events on the bus; the
 * mixer decides the clip.
 *
 * The canvas fills its container edge to edge: the world keeps a fixed design
 * height and takes its width from the surface's aspect (clamped), so the game
 * runs true full-screen inside the fullscreen overlay with no letterboxing.
 */
export default function FlappyGame({ seed, paused, onScore, onGameOver }: ArcadeGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<FlappyState>(initFlappy(seed));
  const fxRef = useRef<FlappyFx>(createFx());
  const overRef = useRef(false);
  const scaleRef = useRef(1);
  /** Mirrors `paused` for the input handlers (same pattern as SnakeGame). */
  const pausedRef = useRef(paused);
  // Seeded from the design size (not stateRef — refs must not be read during
  // render); `fit` rebuilds them for the real surface on mount.
  const cloudsRef = useRef<readonly Cloud[]>(buildClouds(BASE_W, BASE_H - GROUND_H));

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    renderFlappy(ctx, stateRef.current, fxRef.current, cloudsRef.current, scaleRef.current);
  }, []);

  /** Fit the world (and the backing store) to the canvas's on-screen box. */
  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const boxW = canvas.clientWidth;
    const boxH = canvas.clientHeight;
    if (boxW < 1 || boxH < 1) return; // not laid out yet (or jsdom)

    const aspect = boxW / boxH;
    let width = BASE_H * aspect;
    let height = BASE_H;
    if (width < MIN_W) {
      width = MIN_W;
      height = MIN_W / aspect;
    } else if (width > MAX_W) {
      width = MAX_W;
      height = MAX_W / aspect;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.round(boxW * dpr);
    canvas.height = Math.round(boxH * dpr);
    scaleRef.current = canvas.width / width;

    const next = flappyResize(stateRef.current, width, height);
    if (next !== stateRef.current) {
      stateRef.current = next;
      cloudsRef.current = buildClouds(width, next.groundY);
    }
    draw();
  }, [draw]);

  // Fit on mount and follow the container (overlay resize, fullscreen toggle).
  useEffect(() => {
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    const canvas = canvasRef.current;
    if (canvas) observer.observe(canvas);
    return () => observer.disconnect();
  }, [fit]);

  /** One fixed physics step plus the events that step implies. */
  const advance = useCallback(() => {
    const prev = stateRef.current;
    const next = flappyTick(prev);
    stateRef.current = next;
    stepFx(fxRef.current, FLAPPY_STEP, next.phase);

    if (next.score !== prev.score) {
      onScore(next.score);
      bus.emit("arcade-point");
    }
    // Crash: thud + flash + shake, then the bird tumbles before the run is
    // reported (the game-over cue lands when it settles, below).
    if (prev.phase === "play" && next.phase !== "play") {
      hitFx(fxRef.current);
      bus.emit("arcade-hit");
    }
    if (next.phase === "over" && !overRef.current) {
      overRef.current = true;
      bus.emit("arcade-over");
      onGameOver(next.score);
    }
  }, [onScore, onGameOver]);

  useEffect(() => {
    if (paused) return;
    let raf = 0;
    let last = 0;
    let acc = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!last) last = now;
      acc += Math.min(MAX_FRAME_SECONDS, (now - last) / 1000);
      last = now;
      let steps = 0;
      while (acc >= FLAPPY_STEP && steps < MAX_STEPS_PER_FRAME) {
        advance();
        acc -= FLAPPY_STEP;
        steps += 1;
      }
      if (steps >= MAX_STEPS_PER_FRAME) acc = 0;
      draw();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [paused, draw, advance]);

  const flap = useCallback(() => {
    // All input is gated on not-paused: a flap behind the pause menu (or during
    // auto-pause) would mutate the run and emit audio while nothing ticks.
    if (pausedRef.current) return;
    const prev = stateRef.current;
    if (prev.phase !== "ready" && prev.phase !== "play") return;
    stateRef.current = flappyFlap(prev);
    emitFlapPuff(fxRef.current, prev.birdX, prev.birdY);
    bus.emit("arcade-flap");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " && e.key !== "ArrowUp" && e.key !== "w" && e.key !== "W") return;
      e.preventDefault();
      if (!e.repeat) flap();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flap]);

  return (
    <canvas
      ref={canvasRef}
      className="arcade-canvas arcade-canvas--fill"
      onPointerDown={flap}
    />
  );
}
