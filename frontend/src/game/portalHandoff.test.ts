import { describe, expect, it } from "vitest";
import { HANDOFF_IDLE, handoffEvent, handoffStart } from "./portalHandoff";

/**
 * The Phase A (Phaser camera) / Phase B (React overlay) handoff must reveal the
 * meeting grid exactly once, only when BOTH sides are ready, regardless of
 * which finishes first — no gap (reveal before the burst covers the screen)
 * and no double-flash (two reveals).
 */
describe("portal handoff state machine", () => {
  it("starts waiting with neither side ready", () => {
    expect(handoffStart()).toEqual({ phase: "waiting", aDone: false, bReady: false });
  });

  it("reveals when Phase A finishes after Phase B is ready (B-first ordering)", () => {
    let state = handoffStart();
    let result = handoffEvent(state, "b-ready");
    expect(result.reveal).toBe(false);
    state = result.state;
    result = handoffEvent(state, "a-done");
    expect(result.reveal).toBe(true);
    expect(result.state.phase).toBe("revealed");
  });

  it("reveals when Phase B mounts after Phase A finished (A-first ordering)", () => {
    let state = handoffStart();
    let result = handoffEvent(state, "a-done");
    expect(result.reveal).toBe(false);
    state = result.state;
    result = handoffEvent(state, "b-ready");
    expect(result.reveal).toBe(true);
    expect(result.state.phase).toBe("revealed");
  });

  it("never reveals twice, even on duplicate events", () => {
    let state = handoffStart();
    state = handoffEvent(state, "a-done").state;
    const revealed = handoffEvent(state, "b-ready");
    expect(revealed.reveal).toBe(true);
    for (const event of ["a-done", "b-ready"] as const) {
      const again = handoffEvent(revealed.state, event);
      expect(again.reveal).toBe(false);
      expect(again.state.phase).toBe("revealed");
    }
  });

  it("is idempotent on a repeated one-sided event while waiting", () => {
    let state = handoffStart();
    state = handoffEvent(state, "a-done").state;
    const again = handoffEvent(state, "a-done");
    expect(again.reveal).toBe(false);
    expect(again.state).toEqual({ phase: "waiting", aDone: true, bReady: false });
  });

  it("ignores events while idle (no portal in flight)", () => {
    for (const event of ["a-done", "b-ready"] as const) {
      const result = handoffEvent(HANDOFF_IDLE, event);
      expect(result.reveal).toBe(false);
      expect(result.state).toEqual(HANDOFF_IDLE);
    }
  });
});
