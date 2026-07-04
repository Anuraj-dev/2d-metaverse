import { describe, it, expect } from "vitest";
import {
  initOnAir,
  stepOnAir,
  STILL_MS,
  type OnAirEffect,
  type OnAirInput,
  type OnAirPhase,
  type OnAirState,
} from "./onAir";

/** Run a script of inputs, collecting the (non-"none") effects and final phase. */
function run(inputs: OnAirInput[]): {
  effects: OnAirEffect[];
  phase: OnAirPhase;
  state: OnAirState;
} {
  let state = initOnAir();
  const effects: OnAirEffect[] = [];
  for (const input of inputs) {
    const r = stepOnAir(state, input);
    state = r.state;
    if (r.effect !== "none") effects.push(r.effect);
  }
  return { effects, phase: state.phase, state };
}

const tick = (onStage: boolean, x: number, y: number, now: number): OnAirInput => ({
  type: "tick",
  onStage,
  x,
  y,
  now,
});

describe("stepOnAir — arming & prompt", () => {
  it("crossing the stage while moving never prompts", () => {
    const r = run([
      tick(true, 10, 0, 0),
      tick(true, 20, 0, 100),
      tick(true, 30, 0, 200),
      tick(true, 40, 0, 3000), // moved every tick → clock keeps resetting
    ]);
    expect(r.effects).toEqual([]);
    expect(r.phase).toBe("arming");
  });

  it("standing still on stage for STILL_MS shows the prompt exactly once", () => {
    const r = run([
      tick(true, 100, 100, 0), // arrive → arming (first obs reads as moved)
      tick(true, 100, 100, 500),
      tick(true, 100, 100, STILL_MS - 1), // not yet
      tick(true, 100, 100, STILL_MS), // elapsed → prompt
      tick(true, 100, 100, STILL_MS + 500), // already prompting → no re-emit
    ]);
    expect(r.effects).toEqual(["show-prompt"]);
    expect(r.phase).toBe("prompt");
  });

  it("stillness is measured from when the player last stopped moving", () => {
    const r = run([
      tick(true, 0, 0, 0),
      tick(true, 5, 0, 1500), // still moving at 1.5s
      tick(true, 5, 0, 1500 + STILL_MS - 1), // stopped at 1500, not yet 2s still
      tick(true, 5, 0, 1500 + STILL_MS), // now 2s still
    ]);
    expect(r.effects).toEqual(["show-prompt"]);
  });
});

describe("stepOnAir — confirm / decline", () => {
  it("confirm from the prompt goes on air", () => {
    const r = run([
      tick(true, 0, 0, 0),
      tick(true, 0, 0, STILL_MS),
      { type: "confirm" },
    ]);
    expect(r.effects).toEqual(["show-prompt", "go-on-air"]);
    expect(r.phase).toBe("onair");
  });

  it("decline dismisses the prompt and does NOT re-prompt while still", () => {
    const r = run([
      tick(true, 0, 0, 0),
      tick(true, 0, 0, STILL_MS),
      { type: "decline" },
      tick(true, 0, 0, STILL_MS * 2),
      tick(true, 0, 0, STILL_MS * 3),
    ]);
    expect(r.effects).toEqual(["show-prompt", "hide-prompt"]);
    expect(r.phase).toBe("declined");
  });

  it("after declining, MOVING re-arms and a fresh stillness re-prompts", () => {
    const r = run([
      tick(true, 0, 0, 0),
      tick(true, 0, 0, STILL_MS),
      { type: "decline" },
      tick(true, 7, 0, STILL_MS + 100), // moved → re-arm
      tick(true, 7, 0, STILL_MS + 100 + STILL_MS), // still 2s again
    ]);
    expect(r.effects).toEqual(["show-prompt", "hide-prompt", "show-prompt"]);
    expect(r.phase).toBe("prompt");
  });

  it("after declining, LEAVING and returning re-arms", () => {
    const r = run([
      tick(true, 0, 0, 0),
      tick(true, 0, 0, STILL_MS),
      { type: "decline" },
      tick(false, 0, 0, STILL_MS + 100), // step off (declined → idle, no effect)
      tick(true, 0, 0, STILL_MS + 200), // return → arming
      tick(true, 0, 0, STILL_MS + 200 + STILL_MS), // still 2s
    ]);
    expect(r.effects).toEqual(["show-prompt", "hide-prompt", "show-prompt"]);
    expect(r.phase).toBe("prompt");
  });

  it("moving while the prompt is up dismisses it (crossing never nags)", () => {
    const r = run([
      tick(true, 0, 0, 0),
      tick(true, 0, 0, STILL_MS),
      tick(true, 9, 0, STILL_MS + 50), // walk off the spot
    ]);
    expect(r.effects).toEqual(["show-prompt", "hide-prompt"]);
    expect(r.phase).toBe("arming");
  });

  it("confirm/decline outside the prompt are no-ops", () => {
    const r = run([{ type: "confirm" }, { type: "decline" }, tick(true, 0, 0, 0), { type: "confirm" }]);
    expect(r.effects).toEqual([]);
    expect(r.phase).toBe("arming");
  });
});

describe("stepOnAir — going off air", () => {
  it("stepping off the stage while on air ends the broadcast instantly", () => {
    const r = run([
      tick(true, 0, 0, 0),
      tick(true, 0, 0, STILL_MS),
      { type: "confirm" },
      tick(false, 0, 0, STILL_MS + 500),
    ]);
    expect(r.effects).toEqual(["show-prompt", "go-on-air", "go-off-air"]);
    expect(r.phase).toBe("idle");
  });

  it("moving around while on air keeps broadcasting", () => {
    const r = run([
      tick(true, 0, 0, 0),
      tick(true, 0, 0, STILL_MS),
      { type: "confirm" },
      tick(true, 50, 20, STILL_MS + 100),
      tick(true, 90, 40, STILL_MS + 200),
    ]);
    expect(r.effects).toEqual(["show-prompt", "go-on-air"]);
    expect(r.phase).toBe("onair");
  });

  it("leaving while merely prompting hides the prompt (no off-air)", () => {
    const r = run([
      tick(true, 0, 0, 0),
      tick(true, 0, 0, STILL_MS),
      tick(false, 0, 0, STILL_MS + 10),
    ]);
    expect(r.effects).toEqual(["show-prompt", "hide-prompt"]);
    expect(r.phase).toBe("idle");
  });

  it("leaving while arming (never prompted) emits nothing", () => {
    const r = run([tick(true, 0, 0, 0), tick(true, 0, 0, 100), tick(false, 0, 0, 200)]);
    expect(r.effects).toEqual([]);
    expect(r.phase).toBe("idle");
  });
});
