/**
 * Breakout — pure game rules.
 *
 * Plain values in, plain values out; no Phaser/net/DOM imports. Brick layout
 * and the serve angle are drawn from `rngSeed`, so a seed + input script
 * reproduces a run (see breakout.test.ts). The renderer feeds `breakoutTick`
 * on a fixed timestep (`BREAKOUT_STEP`) with the latest paddle intent.
 *
 * World: origin top-left, `y` down. The ball is a circle; bricks and the
 * paddle are axis-aligned rects. Collision uses only `+ - * /`, `Math.sqrt`,
 * `Math.abs`, `Math.min`/`Math.max` — no wall-clock time.
 *
 * Phases: `ready` (ball sits on the paddle) → `play` → `over`. Clearing a
 * board advances the level in-place (still `play`); losing the last life
 * ends the run.
 */
import { nextFloat } from "./prng";

export type BreakoutPhase = "ready" | "play" | "over";

export type BreakoutEvent =
  | "launch"
  | "brick"
  | "paddle"
  | "wall"
  | "life"
  | "level"
  | "over"
  | "combo";

export interface Brick {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly hp: number;
  readonly points: number;
  readonly row: number;
}

export interface BreakoutState {
  readonly width: number;
  readonly height: number;
  readonly paddleX: number;
  readonly paddleY: number;
  readonly paddleW: number;
  readonly paddleH: number;
  readonly paddleSpeed: number;
  readonly ballX: number;
  readonly ballY: number;
  readonly ballVx: number;
  readonly ballVy: number;
  readonly ballR: number;
  readonly ballSpeed: number;
  readonly bricks: readonly Brick[];
  readonly lives: number;
  readonly level: number;
  readonly score: number;
  readonly combo: number;
  readonly phase: BreakoutPhase;
  readonly rngSeed: number;
}

export interface BreakoutInput {
  /** Pointer aim for the paddle centre, in world x; null when keyboard-only. */
  readonly aim: number | null;
  /** Held keyboard steer: -1 left, 0 none, 1 right. */
  readonly move: -1 | 0 | 1;
  /** True on the tick that should serve a waiting ball. */
  readonly launch: boolean;
}

export interface BreakoutStep {
  readonly state: BreakoutState;
  readonly events: readonly BreakoutEvent[];
}

export const BREAKOUT_STEP = 1 / 120;

export const BREAKOUT_WIDTH = 640;
export const BREAKOUT_HEIGHT = 400;
export const BREAKOUT_LIVES = 3;
export const BREAKOUT_COLS = 10;
export const BREAKOUT_ROWS = 6;
export const BRICK_GAP = 4;
export const BRICK_TOP = 36;
export const BRICK_H = 14;
export const PADDLE_W = 78;
export const PADDLE_H = 10;
export const PADDLE_SPEED = 420;
export const BALL_R = 5.5;
export const BASE_BALL_SPEED = 280;
export const LEVEL_SPEED_STEP = 22;
export const MAX_BALL_SPEED = 420;
export const MIN_VY_FRAC = 0.42;
export const WALL_PAD = 10;

const POINTS_BY_ROW = [60, 50, 40, 30, 20, 10] as const;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function brickField(
  width: number,
  rows: number,
  cols: number,
  hp: number
): Brick[] {
  const inset = WALL_PAD + 6;
  const usable = width - inset * 2;
  const w = (usable - BRICK_GAP * (cols - 1)) / cols;
  const bricks: Brick[] = [];
  for (let row = 0; row < rows; row += 1) {
    const points = POINTS_BY_ROW[row] ?? 10;
    for (let col = 0; col < cols; col += 1) {
      bricks.push({
        x: inset + col * (w + BRICK_GAP),
        y: BRICK_TOP + row * (BRICK_H + BRICK_GAP),
        w,
        h: BRICK_H,
        hp,
        points,
        row,
      });
    }
  }
  return bricks;
}

function paddleY(height: number): number {
  return height - 28;
}

function restBallX(paddleX: number): number {
  return paddleX;
}

function restBallY(height: number, radius: number): number {
  return paddleY(height) - radius - 0.5;
}

function withSpeed(
  vx: number,
  vy: number,
  speed: number
): { vx: number; vy: number } {
  const mag = Math.sqrt(vx * vx + vy * vy);
  if (mag <= 0) return { vx: 0, vy: -speed };
  let nx = (vx / mag) * speed;
  let ny = (vy / mag) * speed;
  const minVy = speed * MIN_VY_FRAC;
  if (Math.abs(ny) < minVy) {
    ny = ny < 0 ? -minVy : minVy;
    const rest = Math.sqrt(Math.max(0, speed * speed - ny * ny));
    nx = nx < 0 ? -rest : rest;
  }
  return { vx: nx, vy: ny };
}

function serveVelocity(seed: number, speed: number): { vx: number; vy: number; seed: number } {
  const draw = nextFloat(seed);
  const side = draw.value < 0.5 ? -1 : 1;
  const tilt = 0.35 + draw.value * 0.45;
  const { vx, vy } = withSpeed(side * tilt, -1, speed);
  return { vx, vy, seed: draw.seed };
}

function levelHp(level: number): number {
  return level >= 3 ? 2 : 1;
}

function levelSpeed(level: number): number {
  return Math.min(MAX_BALL_SPEED, BASE_BALL_SPEED + (level - 1) * LEVEL_SPEED_STEP);
}

function levelRows(level: number): number {
  return Math.min(BREAKOUT_ROWS, 4 + level);
}

/**
 * Minimum court height that still fits the brick field, ball rest, and paddle.
 * Portrait cabinets pass a larger height; the default desktop court is 400.
 */
const MIN_COURT_HEIGHT =
  BRICK_TOP + BREAKOUT_ROWS * (BRICK_H + BRICK_GAP) + 80;

export function initBreakout(seed: number, height = BREAKOUT_HEIGHT): BreakoutState {
  const width = BREAKOUT_WIDTH;
  const courtHeight =
    Number.isFinite(height) && height >= MIN_COURT_HEIGHT ? height : BREAKOUT_HEIGHT;
  const paddleX = width / 2;
  return {
    width,
    height: courtHeight,
    paddleX,
    paddleY: paddleY(courtHeight),
    paddleW: PADDLE_W,
    paddleH: PADDLE_H,
    paddleSpeed: PADDLE_SPEED,
    ballX: restBallX(paddleX),
    ballY: restBallY(courtHeight, BALL_R),
    ballVx: 0,
    ballVy: 0,
    ballR: BALL_R,
    ballSpeed: BASE_BALL_SPEED,
    bricks: brickField(width, levelRows(1), BREAKOUT_COLS, levelHp(1)),
    lives: BREAKOUT_LIVES,
    level: 1,
    score: 0,
    combo: 0,
    phase: "ready",
    rngSeed: seed >>> 0 || 1,
  };
}

function steerPaddle(state: BreakoutState, input: BreakoutInput, dt: number): number {
  const half = state.paddleW / 2;
  const minX = WALL_PAD + half;
  const maxX = state.width - WALL_PAD - half;
  if (input.aim !== null) return clamp(input.aim, minX, maxX);
  return clamp(state.paddleX + input.move * state.paddleSpeed * dt, minX, maxX);
}

function circleHitsRect(
  cx: number,
  cy: number,
  r: number,
  x: number,
  y: number,
  w: number,
  h: number
): boolean {
  const closestX = clamp(cx, x, x + w);
  const closestY = clamp(cy, y, y + h);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= r * r;
}

function bounceOffRect(
  cx: number,
  cy: number,
  vx: number,
  vy: number,
  r: number,
  x: number,
  y: number,
  w: number,
  h: number
): { vx: number; vy: number; x: number; y: number } {
  const closestX = clamp(cx, x, x + w);
  const closestY = clamp(cy, y, y + h);
  const dx = cx - closestX;
  const dy = cy - closestY;
  if (Math.abs(dx) > Math.abs(dy)) {
    return {
      vx: -vx,
      vy,
      x: dx < 0 ? x - r : x + w + r,
      y: cy,
    };
  }
  return {
    vx,
    vy: -vy,
    x: cx,
    y: dy < 0 ? y - r : y + h + r,
  };
}

function bouncePaddle(
  state: BreakoutState,
  ballX: number,
  speed: number
): { vx: number; vy: number } {
  const half = state.paddleW / 2;
  const hit = clamp((ballX - state.paddleX) / half, -1, 1);
  return withSpeed(hit * 0.95, -1, speed);
}

function refillBricks(state: BreakoutState, level: number): readonly Brick[] {
  return brickField(state.width, levelRows(level), BREAKOUT_COLS, levelHp(level));
}

function parkBall(state: BreakoutState, paddleX: number, lives: number): BreakoutState {
  return {
    ...state,
    paddleX,
    ballX: restBallX(paddleX),
    ballY: restBallY(state.height, state.ballR),
    ballVx: 0,
    ballVy: 0,
    combo: 0,
    lives,
    phase: lives <= 0 ? "over" : "ready",
  };
}

/**
 * Advance one physics step. `dt` is seconds; the renderer uses `BREAKOUT_STEP`.
 * Terminal states (`over`) are identity so a finishing overlay can keep ticking.
 */
export function breakoutTick(
  state: BreakoutState,
  input: BreakoutInput,
  dt: number = BREAKOUT_STEP
): BreakoutStep {
  if (state.phase === "over") return { state, events: [] };

  const paddleX = steerPaddle(state, input, dt);
  if (state.phase === "ready") {
    let next: BreakoutState = {
      ...state,
      paddleX,
      ballX: restBallX(paddleX),
      ballY: restBallY(state.height, state.ballR),
    };
    if (!input.launch) return { state: next, events: [] };
    const served = serveVelocity(next.rngSeed, next.ballSpeed);
    next = {
      ...next,
      phase: "play",
      ballVx: served.vx,
      ballVy: served.vy,
      rngSeed: served.seed,
    };
    return { state: next, events: ["launch"] };
  }

  const events: BreakoutEvent[] = [];
  let ballX = state.ballX + state.ballVx * dt;
  let ballY = state.ballY + state.ballVy * dt;
  let vx = state.ballVx;
  let vy = state.ballVy;
  let speed = state.ballSpeed;
  const r = state.ballR;
  const left = WALL_PAD + r;
  const right = state.width - WALL_PAD - r;
  const top = WALL_PAD + r;

  if (ballX <= left) {
    ballX = left;
    vx = Math.abs(vx);
    events.push("wall");
  } else if (ballX >= right) {
    ballX = right;
    vx = -Math.abs(vx);
    events.push("wall");
  }
  if (ballY <= top) {
    ballY = top;
    vy = Math.abs(vy);
    events.push("wall");
  }

  if (ballY - r > state.height) {
    const parked = parkBall({ ...state, paddleX }, paddleX, state.lives - 1);
    events.push("life");
    if (parked.phase === "over") events.push("over");
    return { state: parked, events };
  }

  const paddleRect = {
    x: paddleX - state.paddleW / 2,
    y: state.paddleY,
    w: state.paddleW,
    h: state.paddleH,
  };
  if (vy > 0 && circleHitsRect(ballX, ballY, r, paddleRect.x, paddleRect.y, paddleRect.w, paddleRect.h)) {
    const bounced = bouncePaddle({ ...state, paddleX }, ballX, speed);
    vx = bounced.vx;
    vy = bounced.vy;
    ballY = state.paddleY - r - 0.5;
    events.push("paddle");
  }

  let bricks = state.bricks;
  let score = state.score;
  let combo = events.includes("paddle") ? 0 : state.combo;
  let hitIndex = -1;
  for (let i = 0; i < bricks.length; i += 1) {
    const brick = bricks[i];
    if (!brick || brick.hp <= 0) continue;
    if (circleHitsRect(ballX, ballY, r, brick.x, brick.y, brick.w, brick.h)) {
      hitIndex = i;
      break;
    }
  }
  if (hitIndex >= 0) {
    const brick = bricks[hitIndex];
    if (brick) {
      const bounced = bounceOffRect(ballX, ballY, vx, vy, r, brick.x, brick.y, brick.w, brick.h);
      vx = bounced.vx;
      vy = bounced.vy;
      ballX = bounced.x;
      ballY = bounced.y;
      const hp = brick.hp - 1;
      const nextBricks = bricks.slice();
      nextBricks[hitIndex] = { ...brick, hp };
      bricks = nextBricks;
      events.push("brick");
      if (hp <= 0) {
        combo += 1;
        const gain = brick.points * combo;
        score += gain;
        if (combo >= 3) events.push("combo");
      }
    }
  }

  const remaining = bricks.filter((b) => b.hp > 0);
  if (remaining.length === 0) {
    const level = state.level + 1;
    speed = levelSpeed(level);
    const served = serveVelocity(state.rngSeed, speed);
    events.push("level");
    return {
      state: {
        ...state,
        paddleX,
        ballX: restBallX(paddleX),
        ballY: restBallY(state.height, r),
        ballVx: served.vx,
        ballVy: served.vy,
        ballSpeed: speed,
        bricks: refillBricks(state, level),
        level,
        score,
        combo: 0,
        phase: "play",
        rngSeed: served.seed,
      },
      events,
    };
  }

  const scaled = withSpeed(vx, vy, speed);
  return {
    state: {
      ...state,
      paddleX,
      ballX,
      ballY,
      ballVx: scaled.vx,
      ballVy: scaled.vy,
      ballSpeed: speed,
      bricks: remaining,
      score,
      combo,
      phase: "play",
    },
    events,
  };
}
