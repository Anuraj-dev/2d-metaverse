import { describe, expect, it } from "vitest";
import {
  BASE_BALL_SPEED,
  BREAKOUT_COLS,
  BREAKOUT_HEIGHT,
  BREAKOUT_LIVES,
  BREAKOUT_STEP,
  BREAKOUT_WIDTH,
  breakoutTick,
  initBreakout,
  type BreakoutInput,
  type BreakoutState,
} from "./breakout";

const HOLD: BreakoutInput = { aim: null, move: 0, launch: false };
const LAUNCH: BreakoutInput = { aim: null, move: 0, launch: true };

function play(state: BreakoutState, input: BreakoutInput = HOLD): BreakoutState {
  return breakoutTick(state, input).state;
}

function launch(seed = 1): BreakoutState {
  return play(initBreakout(seed), LAUNCH);
}

describe("initBreakout", () => {
  it("starts ready with a full brick field, three lives, and a parked ball", () => {
    const s = initBreakout(1);
    expect(s.phase).toBe("ready");
    expect(s.lives).toBe(BREAKOUT_LIVES);
    expect(s.score).toBe(0);
    expect(s.level).toBe(1);
    expect(s.bricks.length).toBeGreaterThan(BREAKOUT_COLS * 3);
    expect(s.bricks.every((b) => b.hp > 0)).toBe(true);
    expect(s.ballVx).toBe(0);
    expect(s.ballVy).toBe(0);
    expect(s.paddleX).toBe(BREAKOUT_WIDTH / 2);
    expect(s.ballX).toBe(s.paddleX);
    expect(s.height).toBe(BREAKOUT_HEIGHT);
    expect(s.paddleY).toBe(BREAKOUT_HEIGHT - 28);
  });

  it("accepts a taller court without changing the brick field width", () => {
    const s = initBreakout(1, 720);
    expect(s.width).toBe(BREAKOUT_WIDTH);
    expect(s.height).toBe(720);
    expect(s.paddleY).toBe(720 - 28);
    const desktop = initBreakout(1);
    expect(s.bricks.length).toBe(desktop.bricks.length);
    expect(s.bricks[0]?.x).toBe(desktop.bricks[0]?.x);
    expect(s.bricks[0]?.w).toBe(desktop.bricks[0]?.w);
  });
});

describe("breakoutTick — ready / serve", () => {
  it("keeps the ball glued to a steered paddle until launch", () => {
    const left = play(initBreakout(1), { aim: null, move: -1, launch: false });
    expect(left.phase).toBe("ready");
    expect(left.paddleX).toBeLessThan(BREAKOUT_WIDTH / 2);
    expect(left.ballX).toBe(left.paddleX);
    expect(left.ballY).toBeLessThan(left.paddleY);
  });

  it("serves on launch and starts the run", () => {
    const s = launch(7);
    expect(s.phase).toBe("play");
    expect(s.ballVy).toBeLessThan(0);
    expect(Math.abs(s.ballVx) + Math.abs(s.ballVy)).toBeGreaterThan(0);
  });

  it("is a no-op once the run is over", () => {
    const over: BreakoutState = { ...initBreakout(1), phase: "over", lives: 0 };
    expect(breakoutTick(over, LAUNCH).state).toBe(over);
    expect(breakoutTick(over, LAUNCH).events).toEqual([]);
  });
});

describe("breakoutTick — paddle and walls", () => {
  it("clamps pointer aim to the inner walls", () => {
    const s = play(initBreakout(1), { aim: -400, move: 0, launch: false });
    expect(s.paddleX).toBeGreaterThan(s.paddleW / 2);
    const right = play(initBreakout(1), { aim: 4000, move: 0, launch: false });
    expect(right.paddleX).toBeLessThan(BREAKOUT_WIDTH - s.paddleW / 2);
  });

  it("bounces off the side walls instead of leaving the court", () => {
    let s = launch(3);
    s = {
      ...s,
      ballX: 12,
      ballY: 220,
      ballVx: -400,
      ballVy: 0,
    };
    const next = play(s);
    expect(next.ballVx).toBeGreaterThan(0);
    expect(next.ballX).toBeGreaterThanOrEqual(s.ballR);
  });
});

describe("breakoutTick — bricks, lives, levels", () => {
  it("breaks a brick, awards its points, and emits brick", () => {
    const base = launch(1);
    const brick = base.bricks[0];
    if (!brick) throw new Error("expected a brick");
    const aimed: BreakoutState = {
      ...base,
      ballX: brick.x + brick.w / 2,
      ballY: brick.y + brick.h + base.ballR - 0.5,
      ballVx: 0,
      ballVy: -BASE_BALL_SPEED,
    };
    const step = breakoutTick(aimed, HOLD);
    expect(step.events).toContain("brick");
    expect(step.state.score).toBeGreaterThan(0);
    expect(step.state.bricks.length).toBeLessThan(aimed.bricks.length);
  });

  it("drops a life and returns to ready when the ball falls off the bottom", () => {
    const s: BreakoutState = {
      ...launch(1),
      ballX: BREAKOUT_WIDTH / 2,
      ballY: BREAKOUT_HEIGHT + 20,
      ballVx: 0,
      ballVy: 200,
    };
    const step = breakoutTick(s, HOLD);
    expect(step.events).toContain("life");
    expect(step.state.lives).toBe(BREAKOUT_LIVES - 1);
    expect(step.state.phase).toBe("ready");
    expect(step.state.combo).toBe(0);
  });

  it("ends the run on the last dropped life", () => {
    const s: BreakoutState = {
      ...launch(1),
      lives: 1,
      ballX: BREAKOUT_WIDTH / 2,
      ballY: BREAKOUT_HEIGHT + 20,
      ballVx: 0,
      ballVy: 200,
    };
    const step = breakoutTick(s, HOLD);
    expect(step.events).toContain("over");
    expect(step.state.phase).toBe("over");
    expect(step.state.lives).toBe(0);
  });

  it("refills a harder field when the last brick is cleared", () => {
    const base = launch(1);
    const last = base.bricks[0];
    if (!last) throw new Error("expected a brick");
    const s: BreakoutState = {
      ...base,
      bricks: [{ ...last, hp: 1 }],
      ballX: last.x + last.w / 2,
      ballY: last.y + last.h + base.ballR - 0.5,
      ballVx: 0,
      ballVy: -BASE_BALL_SPEED,
    };
    const step = breakoutTick(s, HOLD);
    expect(step.events).toContain("level");
    expect(step.state.level).toBe(2);
    expect(step.state.bricks.length).toBeGreaterThan(1);
    expect(step.state.phase).toBe("play");
  });
});

describe("determinism", () => {
  function run(seed: number): BreakoutState {
    let s = initBreakout(seed);
    for (let i = 0; i < 4000 && s.phase !== "over"; i += 1) {
      const launchNow = s.phase === "ready" && i % 30 === 0;
      const move = (i % 80 < 40 ? -1 : 1) as -1 | 1;
      s = breakoutTick(s, { aim: null, move, launch: launchNow }, BREAKOUT_STEP).state;
    }
    return s;
  }

  it("same seed + input script ⇒ identical outcome", () => {
    expect(run(555)).toEqual(run(555));
  });

  it("different seeds diverge", () => {
    expect(run(555).rngSeed).not.toBe(run(777).rngSeed);
  });
});
