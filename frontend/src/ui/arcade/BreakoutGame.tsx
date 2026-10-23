import { useCallback, useEffect, useRef, useState } from "react";
import { bus } from "../../game/eventBus";
import {
  BREAKOUT_HEIGHT,
  BREAKOUT_STEP,
  BREAKOUT_WIDTH,
  breakoutTick,
  initBreakout,
  type BreakoutEvent,
  type BreakoutInput,
  type BreakoutState,
} from "../../game/arcade/breakout";
import {
  burst,
  initJuice,
  popup,
  shake,
  stepJuice,
  type JuiceState,
} from "../../game/arcade/juice";
import { useReducedMotion } from "../reducedMotionBridge";
import { renderBreakout } from "./breakout/render";
import type { ArcadeGameProps } from "./gameTypes";

const SCALE = 2;
const MAX_DPR = 2;
const MAX_FRAME_SECONDS = 0.25;
const MAX_STEPS_PER_FRAME = 60;

/** Portrait cabinet: taller court so the 640-wide field fills the surface. */
function portraitCourtHeight(cssWidth: number, cssHeight: number): number {
  if (!(cssWidth > 0) || cssHeight <= cssWidth) return BREAKOUT_HEIGHT;
  return Math.max(BREAKOUT_HEIGHT, Math.round(BREAKOUT_WIDTH * (cssHeight / cssWidth)));
}

const BUS_FOR_EVENT: Readonly<Partial<Record<BreakoutEvent, "arcade-point" | "arcade-hit" | "arcade-over" | "arcade-bonus" | "arcade-flap">>> =
  {
    launch: "arcade-flap",
    brick: "arcade-point",
    paddle: "arcade-hit",
    wall: "arcade-hit",
    life: "arcade-hit",
    combo: "arcade-bonus",
    level: "arcade-bonus",
    over: "arcade-over",
  };

/**
 * Thin canvas renderer for the pure Breakout module. Rules stay in
 * game/arcade/breakout — this drives the fixed-step loop, paddle input, and
 * domain events on the bus.
 */
export default function BreakoutGame({
  seed,
  paused,
  shake: shakePref,
  onScore,
  onGameOver,
}: ArcadeGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<BreakoutState>(initBreakout(seed));
  const juiceRef = useRef<JuiceState>(initJuice(seed));
  const overRef = useRef(false);
  const pausedRef = useRef(paused);
  const keysRef = useRef({ left: false, right: false });
  const aimRef = useRef<number | null>(null);
  const launchRef = useRef(false);
  const reducedMotion = useReducedMotion();
  const shakeEnabled = shakePref && !reducedMotion;
  const [live, setLive] = useState("Ready. Click or press Space to serve. 3 lives left.");

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const state = stateRef.current;
    const scaleX = ctx.canvas.width / state.width;
    const scaleY = ctx.canvas.height / state.height;
    if (!(scaleX > 0) || !(scaleY > 0)) return;
    renderBreakout(ctx, state, juiceRef.current, scaleX, scaleY, shakeEnabled);
  }, [shakeEnabled]);

  useEffect(() => {
    draw();
  }, [draw]);

  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const boxW = canvas.clientWidth;
    const boxH = canvas.clientHeight;
    if (boxW < 1 || boxH < 1) return;

    const portrait = boxH > boxW;
    if (!portrait) {
      const nextW = BREAKOUT_WIDTH * SCALE;
      const nextH = BREAKOUT_HEIGHT * SCALE;
      if (canvas.width !== nextW || canvas.height !== nextH) {
        canvas.width = nextW;
        canvas.height = nextH;
      }
      if (stateRef.current.height !== BREAKOUT_HEIGHT && stateRef.current.phase === "ready") {
        stateRef.current = initBreakout(seed);
      }
      draw();
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const pxW = Math.max(1, Math.round(boxW * dpr));
    const pxH = Math.max(1, Math.round(boxH * dpr));
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    const worldH = portraitCourtHeight(boxW, boxH);
    if (stateRef.current.height !== worldH && stateRef.current.phase === "ready") {
      stateRef.current = initBreakout(seed, worldH);
    }
    draw();
  }, [draw, seed]);

  useEffect(() => {
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    const canvas = canvasRef.current;
    if (canvas) observer.observe(canvas);
    return () => observer.disconnect();
  }, [fit]);

  const sampleInput = useCallback((): BreakoutInput => {
    const move: -1 | 0 | 1 = keysRef.current.left === keysRef.current.right
      ? 0
      : keysRef.current.left
        ? -1
        : 1;
    const launch = launchRef.current;
    launchRef.current = false;
    return { aim: aimRef.current, move, launch };
  }, []);

  const applyEvents = useCallback(
    (prev: BreakoutState, next: BreakoutState, events: readonly BreakoutEvent[]) => {
      if (next.score !== prev.score) onScore(next.score);
      let juice = juiceRef.current;
      for (const ev of events) {
        const busName = BUS_FOR_EVENT[ev];
        if (busName) bus.emit(busName);
        if (ev === "brick") {
          juice = burst(juice, {
            x: next.ballX,
            y: next.ballY,
            count: reducedMotion ? 0 : 10,
            color: "#f2c14e",
            speed: 3.2,
            life: 420,
            size: 2.2,
          });
          juice = popup(juice, {
            x: next.ballX,
            y: next.ballY - 8,
            text: `+${next.score - prev.score}`,
            color: "#7fd1b9",
          });
          if (shakeEnabled) juice = shake(juice, 0.18);
        }
        if ((ev === "life" || ev === "over") && shakeEnabled) juice = shake(juice, 0.55);
      }
      juiceRef.current = juice;
      if (next.phase !== prev.phase || next.lives !== prev.lives) {
        if (next.phase === "ready") {
          setLive(`Ready. Click or press Space to serve. ${next.lives} lives left.`);
        } else if (next.phase === "over") {
          setLive(`Game over. Final score ${next.score}.`);
        } else if (next.phase === "play" && prev.phase === "ready") {
          setLive(`Playing. ${next.lives} lives left.`);
        }
      }
      if (next.phase === "over" && !overRef.current) {
        overRef.current = true;
        onGameOver(next.score);
      }
    },
    [onScore, onGameOver, reducedMotion, shakeEnabled]
  );

  const advance = useCallback(() => {
    const prev = stateRef.current;
    const step = breakoutTick(prev, sampleInput());
    stateRef.current = step.state;
    juiceRef.current = stepJuice(juiceRef.current, BREAKOUT_STEP * 1000);
    applyEvents(prev, step.state, step.events);
  }, [sampleInput, applyEvents]);

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
      while (acc >= BREAKOUT_STEP && steps < MAX_STEPS_PER_FRAME) {
        advance();
        acc -= BREAKOUT_STEP;
        steps += 1;
      }
      if (steps >= MAX_STEPS_PER_FRAME) acc = 0;
      draw();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [paused, draw, advance]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!e.repeat && !pausedRef.current) launchRef.current = true;
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        e.preventDefault();
        keysRef.current.left = true;
      }
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        e.preventDefault();
        keysRef.current.right = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        keysRef.current.left = false;
      }
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        keysRef.current.right = false;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const aimFromClient = useCallback((clientX: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const worldW = stateRef.current.width;
    const worldH = stateRef.current.height;
    const scale = Math.min(rect.width / worldW, rect.height / worldH);
    const left = rect.left + (rect.width - worldW * scale) / 2;
    return (clientX - left) / scale;
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="arcade-canvas arcade-canvas--breakout"
      width={BREAKOUT_WIDTH * SCALE}
      height={BREAKOUT_HEIGHT * SCALE}
      role="img"
      aria-label={`Breakout. ${live} Move the paddle with the mouse or A and D.`}
      onPointerMove={(e) => {
        aimRef.current = aimFromClient(e.clientX);
      }}
      onPointerLeave={() => {
        aimRef.current = null;
      }}
      onPointerDown={(e) => {
        aimRef.current = aimFromClient(e.clientX);
        if (!pausedRef.current) launchRef.current = true;
      }}
    />
  );
}
