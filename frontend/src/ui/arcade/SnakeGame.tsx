import { useCallback, useEffect, useRef, useState } from "react";
import { bus, type ArcadeBusEvent } from "../../game/eventBus";
import {
  DEFAULT_SNAKE_HEIGHT,
  DEFAULT_SNAKE_WIDTH,
  initSnake,
  snakeInput,
  snakeFrame,
  type Dir,
  type Difficulty,
  type SnakeEvent,
  type SnakeState,
} from "../../game/arcade/snake";
import { createFoodAnim } from "./snake/food";
import { createFx, startGameOverFx, stepGameOverFx } from "./snake/fx";
import {
  GLIDE_MS,
  interpolateSnakeBody,
  isSingleTickBodyTransition,
  renderHeading,
} from "./snake/interp";
import { renderSnake } from "./snake/render";
import { useReducedMotion } from "../reducedMotionBridge";
import type { ArcadeGameProps } from "./gameTypes";

const MAX_DPR = 2;
/**
 * FIXED cell size in CSS px (the original game's grid). Cells are NEVER scaled
 * to fit the stage — that just reads as "zoomed in". The board fills the stage
 * by GRID SIZE instead: more cells, same 20px each.
 */
const CELL_CSS = 20;
/** Smallest playable board if the stage is tiny. */
const MIN_COLS = 20;
const MIN_ROWS = 12;
/**
 * Minimum letterbox per side. The stage surface clips with a 10px border
 * radius; anything closer than ~3px to its edge gets a bite taken out of the
 * corner cells, which players read as "the end cell is cut off".
 */
const EDGE_INSET = 4;
const DIFFICULTY_KEY = "arcadeSnakeDifficulty";
const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];

/** Board size in whole cells for the current stage box. */
interface Board {
  readonly cols: number;
  readonly rows: number;
}

interface SnakeMotion {
  readonly previous: SnakeState["body"];
  readonly current: SnakeState["body"];
  readonly dir: Dir;
  readonly snap: boolean;
}

const INITIAL_BOARD: Board = { cols: MIN_COLS, rows: MIN_ROWS };
/** Fixed dimensions keep globally ranked Snake runs comparable. */
const SCORE_BOARD: Board = { cols: DEFAULT_SNAKE_WIDTH, rows: DEFAULT_SNAKE_HEIGHT };

/** Reducer domain event → bus event name (glue only — no game rules). */
const BUS_FOR_EVENT: Readonly<Partial<Record<SnakeEvent, ArcadeBusEvent>>> = {
  eat: "arcade-eat",
  bonus: "arcade-bonus",
  milestone: "arcade-milestone",
  die: "arcade-snake-over",
  win: "arcade-over",
  // bonus-expired is silent
};

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

function readStoredDifficulty(): Difficulty {
  try {
    const raw = localStorage.getItem(DIFFICULTY_KEY);
    if (raw === "easy" || raw === "normal" || raw === "hard") return raw;
  } catch {
    /* private mode / denied — fall through */
  }
  return "normal";
}

function writeStoredDifficulty(d: Difficulty): void {
  try {
    localStorage.setItem(DIFFICULTY_KEY, d);
  } catch {
    /* ignore */
  }
}

/**
 * Thin canvas renderer for the pure Snake module. A new run remounts this
 * component (ArcadeOverlay keys it by seed), so the refs init fresh from `seed`.
 * All game rules stay in game/arcade/snake — this only draws the returned state,
 * forwards input, and relays reducer-emitted domain events to the bus.
 */
export default function SnakeGame({
  seed,
  paused,
  shake,
  onScore,
  onGameOver,
  bestScore = null,
}: ArcadeGameProps) {
  const reducedMotion = useReducedMotion();
  const shakeEnabled = shake && !reducedMotion;
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<SnakeState | null>(null);
  const motionRef = useRef<SnakeMotion | null>(null);
  const accMsRef = useRef(0);
  const foodAnimRef = useRef(createFoodAnim());
  const fxRef = useRef(createFx());
  const overRef = useRef(false);
  /** Cell size in DEVICE pixels — what every drawing module scales off. */
  const cellRef = useRef(CELL_CSS);
  const highscoreBeatenRef = useRef(false);
  const bestScoreRef = useRef(bestScore);
  const pausedRef = useRef(paused);
  /** Latest measurement of the stage; only adopted between runs. */
  const measuredRef = useRef<Board>(INITIAL_BOARD);
  /** Board the canvas backing store is currently sized for (mirror of state). */
  const sizedRef = useRef<Board>(INITIAL_BOARD);
  const phaseRef = useRef<"menu" | "play">("menu");
  /** Board the canvas is currently sized for (frozen while a run is live). */
  const [board, setBoard] = useState<Board>(INITIAL_BOARD);
  const [phase, setPhase] = useState<"menu" | "play">("menu");
  const [difficulty, setDifficulty] = useState<Difficulty>(readStoredDifficulty);

  // Keep the latest props available to the raf loop / key handlers without
  // writing refs during render (react-hooks/refs).
  useEffect(() => {
    bestScoreRef.current = bestScore;
  }, [bestScore]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // Menu: show an idle board at the current size so the surface isn't blank.
    const s =
      stateRef.current ??
      initSnake(seed, {
        difficulty,
        width: board.cols,
        height: board.rows,
      });

    const motion = motionRef.current;
    const interpolate =
      phaseRef.current === "play" &&
      !pausedRef.current &&
      !reducedMotion &&
      s.alive &&
      !s.won &&
      !fxRef.current.animating;
    const tickMs = 1000 / Math.max(0.5, s.speed);
    const body = motion
      ? interpolateSnakeBody(
          motion.previous,
          motion.current,
          accMsRef.current / Math.min(tickMs, GLIDE_MS),
          motion.snap || !interpolate
        )
      : s.body;

    renderSnake(
      ctx,
      s,
      fxRef.current,
      foodAnimRef.current,
      performance.now(),
      cellRef.current,
      body,
      renderHeading(motion?.dir ?? s.dir, s.dirQueue),
      shakeEnabled,
      !reducedMotion,
    );
  }, [seed, difficulty, board, reducedMotion, shakeEnabled]);

  /**
   * Place the canvas inside the stage box. Two jobs:
   * - Land it on WHOLE page pixels: flex centring an odd letterbox remainder
   *   puts the canvas on a half-pixel boundary, which smears every cell border
   *   (worst at the board edge, where the outermost row/column reads as "half
   *   a cell") on dpr-1 screens.
   * - If the box shrank below the live board mid-run (e.g. leaving fullscreen),
   *   downscale uniformly instead of cropping — hidden edge cells made the
   *   snake steer blind near walls. Cells are still never scaled UP.
   */
  const layout = useCallback(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const idealW = sizedRef.current.cols * CELL_CSS;
    const idealH = sizedRef.current.rows * CELL_CSS;
    const availW = root.clientWidth - 2 * EDGE_INSET;
    const availH = root.clientHeight - 2 * EDGE_INSET;
    if (availW < 1 || availH < 1) return;
    const scale = Math.min(1, availW / idealW, availH / idealH);
    const w = Math.round(idealW * scale);
    const h = Math.round(idealH * scale);
    // Round against the page, not the box: the box's own origin can sit on a
    // fractional pixel (fr-grid layout), which local rounding would keep.
    const rect = root.getBoundingClientRect();
    const left = Math.round(rect.left + (root.clientWidth - w) / 2) - rect.left;
    const top = Math.round(rect.top + (root.clientHeight - h) / 2) - rect.top;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.left = `${left}px`;
    canvas.style.top = `${top}px`;
  }, []);

  /**
   * How many whole FIXED-size cells the stage can show. A mid-run resize only
   * re-lays-out what is already on screen — the live board keeps its
   * dimensions; the next run picks the new ones up.
   */
  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const boxW = root.clientWidth - 2 * EDGE_INSET;
    const boxH = root.clientHeight - 2 * EDGE_INSET;
    if (boxW < 1 || boxH < 1) return;
    const next: Board = {
      cols: Math.max(MIN_COLS, Math.floor(boxW / CELL_CSS)),
      rows: Math.max(MIN_ROWS, Math.floor(boxH / CELL_CSS)),
    };
    measuredRef.current = next;
    layout();
    if (phaseRef.current !== "menu") return;
    setBoard((prev) =>
      prev.cols === next.cols && prev.rows === next.rows ? prev : next
    );
  }, [layout]);

  // Re-measure on container resize (overlay layout, window) and on fullscreen
  // enter/leave, which can change the box without a ResizeObserver-visible
  // layout pass in some browsers.
  useEffect(() => {
    measure();
    const root = rootRef.current;
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (observer && root) observer.observe(root);
    window.addEventListener("resize", measure);
    document.addEventListener("fullscreenchange", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("fullscreenchange", measure);
    };
  }, [measure]);

  // Size the canvas to the board: fixed 20px CSS cells, dpr-aware backing store
  // so the art stays crisp without a single cell ever being scaled.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DPR);
    cellRef.current = CELL_CSS * dpr;
    canvas.width = board.cols * CELL_CSS * dpr;
    canvas.height = board.rows * CELL_CSS * dpr;
    sizedRef.current = board;
    layout();
    draw();
  }, [board, layout, draw]);

  const startRun = useCallback(
    (d: Difficulty) => {
      if (pausedRef.current) return;
      writeStoredDifficulty(d);
      setDifficulty(d);
      // Scored runs always use one board size; CSS layout handles letterboxing
      // on narrow/fullscreen surfaces without changing leaderboard potential.
      setBoard(SCORE_BOARD);
      stateRef.current = initSnake(seed, {
        difficulty: d,
        width: SCORE_BOARD.cols,
        height: SCORE_BOARD.rows,
      });
      const initial = stateRef.current;
      motionRef.current = {
        previous: initial.body,
        current: initial.body,
        dir: initial.dir,
        snap: true,
      };
      accMsRef.current = 0;
      foodAnimRef.current = createFoodAnim();
      fxRef.current = createFx();
      overRef.current = false;
      highscoreBeatenRef.current = false;
      onScore(0);
      setPhase("play");
    },
    [seed, onScore]
  );

  /** Forward reducer events to the bus + score/highscore stings (glue only). */
  const relayEvents = useCallback(
    (prevScore: number, next: SnakeState, events: readonly SnakeEvent[]) => {
      if (next.score !== prevScore) onScore(next.score);

      for (const ev of events) {
        const busName: ArcadeBusEvent | undefined = BUS_FOR_EVENT[ev];
        if (busName) bus.emit(busName);
      }

      // Highscore sting: only when the overlay has a concrete personal best and
      // this run first exceeds it (no parallel leaderboard fetch in the renderer).
      const best = bestScoreRef.current;
      if (
        typeof best === "number" &&
        !highscoreBeatenRef.current &&
        next.score > best
      ) {
        highscoreBeatenRef.current = true;
        const highscoreEvent: ArcadeBusEvent = "arcade-highscore";
        bus.emit(highscoreEvent);
      }
    },
    [onScore]
  );

  // Game loop: raf drives pure snakeFrame (interleaved time + ticks).
  useEffect(() => {
    if (paused || phase !== "play") return;
    let raf = 0;
    let last = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!last) last = now;
      const dt = Math.min(100, now - last);
      last = now;

      const cur = stateRef.current;
      if (!cur) return;

      // Death animation (dt-based) plays after the terminal state is reported;
      // the overlay owns the death-card delay and score submission.
      if (fxRef.current.animating) {
        stepGameOverFx(fxRef.current, dt);
        draw();
        return;
      }

      // Terminal states already settled into death FX / reported win.
      if (!cur.alive || cur.won) {
        if (!cur.alive && !fxRef.current.settled && !fxRef.current.animating) {
          startGameOverFx(fxRef.current);
        }
        if (cur.won && !overRef.current) {
          overRef.current = true;
          onGameOver(cur.score);
        }
        draw();
        return;
      }

      const prevScore = cur.score;
      const result = snakeFrame(cur, accMsRef.current, dt);
      accMsRef.current = result.accMs;
      stateRef.current = result.state;
      if (!result.state.alive || result.state.won) {
        motionRef.current = {
          previous: result.state.body,
          current: result.state.body,
          dir: result.state.dir,
          snap: true,
        };
      } else if (result.state.body !== cur.body) {
        const singleTick = isSingleTickBodyTransition(cur.body, result.state.body);
        motionRef.current = {
          previous: singleTick ? cur.body : result.state.body,
          current: result.state.body,
          dir: result.state.dir,
          snap: !singleTick,
        };
      }
      relayEvents(prevScore, result.state, result.events);

      // Same-frame terminal handling so death FX / win report aren't delayed.
      if (result.events.includes("die")) {
        startGameOverFx(fxRef.current);
        if (!overRef.current) {
          overRef.current = true;
          onGameOver(result.state.score);
        }
      }
      if (result.events.includes("win") && !overRef.current) {
        overRef.current = true;
        onGameOver(result.state.score);
      }
      draw();
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [paused, phase, draw, onGameOver, relayEvents]);

  // A paused surface is a truthful snapshot, never a body left between cells.
  useEffect(() => {
    if (!paused) return;
    const current = stateRef.current;
    if (current) {
      motionRef.current = {
        previous: current.body,
        current: current.body,
        dir: current.dir,
        snap: true,
      };
    }
    draw();
  }, [paused, draw]);

  // Keyboard: steer while playing; Enter starts from the menu. All input is
  // gated on not-paused so a blur/refocus cannot buffer turns mid-pause.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pausedRef.current) return;
      if (phase === "menu") {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          startRun(difficulty);
          return;
        }
        const step =
          e.key === "ArrowRight" || e.key === "ArrowDown"
            ? 1
            : e.key === "ArrowLeft" || e.key === "ArrowUp"
              ? -1
              : 0;
        if (step === 0) return;
        e.preventDefault();
        const at = DIFFICULTIES.indexOf(difficulty);
        const next =
          DIFFICULTIES[
            (at + step + DIFFICULTIES.length) % DIFFICULTIES.length
          ];
        if (!next) return;
        setDifficulty(next);
        writeStoredDifficulty(next);
        return;
      }
      const dir = KEY_DIR[e.key];
      if (!dir || !stateRef.current) return;
      e.preventDefault();
      const st = stateRef.current;
      stateRef.current = snakeInput(st, dir);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, difficulty, startRun]);

  // Paint once on mount / when the menu difficulty changes the preview board.
  useEffect(() => {
    draw();
  }, [draw, phase]);

  return (
    <div
      ref={rootRef}
      className="arcade-snake-root"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        // Letterbox around the sub-cell remainder (original page backdrop).
        background: "#e6e6e6",
      }}
    >
      <canvas
        ref={canvasRef}
        className="arcade-canvas arcade-canvas--snake"
        // Absolutely positioned: `layout` computes a whole-page-pixel offset
        // (flex centring would land on half pixels and smear the cell grid).
        // The art is smooth (rounded segments, radial gradients) and the backing
        // store is already dpr-scaled, so nearest-neighbour would only add
        // aliasing — override the shared canvas rule's `pixelated`.
        style={{
          position: "absolute",
          display: "block",
          background: "#fff",
          imageRendering: "auto",
        }}
      />
      {phase === "menu" && (
        <div
          role="group"
          aria-label="Snake difficulty"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.85)",
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              padding: "30px",
              width: "80%",
              maxWidth: "400px",
              textAlign: "center",
              boxShadow: "0 5px 20px rgba(0, 0, 0, 0.3)",
              fontFamily: "Arial, sans-serif",
            }}
          >
            <h2
              style={{
                margin: "0 0 20px",
                color: "#333",
                fontSize: "28px",
                borderBottom: "2px solid #eee",
                paddingBottom: "10px",
              }}
            >
              Snake
            </h2>
            {DIFFICULTIES.map((d) => {
              const selected = d === difficulty;
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => startRun(d)}
                  onMouseEnter={() => {
                    if (pausedRef.current) return;
                    setDifficulty(d);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    margin: "10px 0",
                    padding: "15px",
                    fontSize: "18px",
                    fontFamily: "inherit",
                    background: selected ? "#0b7dda" : "#2196f3",
                    color: "#fff",
                    border: selected ? "2px solid #fff" : "2px solid transparent",
                    boxShadow: selected ? "0 0 0 2px #0b7dda" : "none",
                    borderRadius: "5px",
                    cursor: "pointer",
                    textTransform: "capitalize",
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
