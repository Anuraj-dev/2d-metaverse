import { describe, expect, it } from "vitest";
import {
  CINEMATIC_IDLE,
  beginPortal,
  cancelPortal,
  finishPortal,
  shouldCapture,
  type PortalCinematic,
} from "./portalCinematic";

/**
 * Generation guard for the portal Phase A cinematic (review round 2).
 *
 * Each test simulates the exact callback interleavings WorldScene sees. The
 * harness mirrors the scene's glue: `sleeps` counts how many times a finish
 * decision would have called `scene.sleep()` — the invariant under attack is
 * "a canceled portal NEVER sleeps the scene". Every cancellation-path test
 * here FAILS if `cancelPortal` stops advancing the generation (the mutation
 * probe from the review: removing the portalOut() generation bump).
 */

/** Run the finish step the way the scene does; count would-be sleeps. */
function runFinish(state: PortalCinematic, gen: number, sleeps: { count: number }) {
  const result = finishPortal(state, gen);
  if (result.finish) sleeps.count += 1;
  return result.state;
}

describe("portal cinematic generation guard", () => {
  it("happy path: capture allowed, finish exactly once (snapshot and timeout race)", () => {
    const sleeps = { count: 0 };
    const begun = beginPortal(CINEMATIC_IDLE);
    let state = begun.state;
    expect(shouldCapture(state, begun.gen)).toBe(true);
    state = runFinish(state, begun.gen, sleeps); // snapshot callback wins
    runFinish(state, begun.gen, sleeps); // safety timeout fires later
    expect(sleeps.count).toBe(1);
  });

  it("exit BEFORE the zoom completes: capture refused, scene ends awake", () => {
    const sleeps = { count: 0 };
    const begun = beginPortal(CINEMATIC_IDLE);
    // Player stands/Leaves during the 350ms zoom (portal-out → cancelPortal).
    const state = cancelPortal(begun.state);
    // The zoom-completion callback (minted under the old gen) then fires:
    expect(shouldCapture(state, begun.gen)).toBe(false);
    // Even if glue skipped that check, the finish step must refuse too:
    runFinish(state, begun.gen, sleeps);
    expect(sleeps.count).toBe(0);
  });

  it("exit AFTER the zoom, BEFORE the snapshot lands: no late a-done, no late sleep", () => {
    const sleeps = { count: 0 };
    const begun = beginPortal(CINEMATIC_IDLE);
    let state = begun.state;
    expect(shouldCapture(state, begun.gen)).toBe(true); // zoom completed, capture started
    state = cancelPortal(state); // portal-out while the renderer snapshot is in flight
    state = runFinish(state, begun.gen, sleeps); // snapshot callback arrives late
    runFinish(state, begun.gen, sleeps); // …and its safety timeout after that
    expect(sleeps.count).toBe(0);
  });

  it("timeout path after a cancel: the safety timeout may not finish a dead portal", () => {
    const sleeps = { count: 0 };
    const begun = beginPortal(CINEMATIC_IDLE);
    let state = begun.state;
    state = cancelPortal(state); // e.g. disconnect tears the meeting down mid-cinematic
    runFinish(state, begun.gen, sleeps); // SNAPSHOT_TIMEOUT_MS fallback fires
    expect(sleeps.count).toBe(0);
  });

  it("teardown/disconnect equals cancel: repeated cancels stay safe and idempotent", () => {
    const sleeps = { count: 0 };
    const begun = beginPortal(CINEMATIC_IDLE);
    let state = cancelPortal(begun.state); // portal-out
    state = cancelPortal(state); // scene teardown on top — still fine
    runFinish(state, begun.gen, sleeps);
    expect(shouldCapture(state, begun.gen)).toBe(false);
    expect(sleeps.count).toBe(0);
  });

  it("cancel then re-enter: old callbacks stay dead, the new generation flows normally", () => {
    const sleeps = { count: 0 };
    const first = beginPortal(CINEMATIC_IDLE);
    let state = cancelPortal(first.state); // canceled mid-cinematic
    const second = beginPortal(state); // latecomer portals in again
    state = second.state;
    // Stale first-generation callbacks arrive interleaved with the live ones:
    expect(shouldCapture(state, first.gen)).toBe(false);
    state = runFinish(state, first.gen, sleeps);
    expect(sleeps.count).toBe(0);
    // The live generation is unaffected by the stale traffic:
    expect(shouldCapture(state, second.gen)).toBe(true);
    runFinish(state, second.gen, sleeps);
    expect(sleeps.count).toBe(1);
  });

  it("a fresh beginPortal invalidates a still-running previous cinematic", () => {
    const sleeps = { count: 0 };
    const first = beginPortal(CINEMATIC_IDLE);
    const second = beginPortal(first.state); // re-begun without an explicit cancel
    let state = second.state;
    expect(shouldCapture(state, first.gen)).toBe(false);
    state = runFinish(state, first.gen, sleeps);
    expect(sleeps.count).toBe(0);
    runFinish(state, second.gen, sleeps);
    expect(sleeps.count).toBe(1);
  });
});
