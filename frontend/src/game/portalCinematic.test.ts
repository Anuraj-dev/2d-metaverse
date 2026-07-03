import { describe, expect, it } from "vitest";
import {
  CINEMATIC_IDLE,
  beginPortal,
  cancelPortal,
  finishPortal,
  runPortalCinematic,
  shouldCapture,
  type CinematicRef,
  type PortalCinematic,
  type PortalCinematicEffects,
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

/**
 * Driver-wiring tests (review round 3). These exercise runPortalCinematic —
 * the effect-injected Phase A sequence — with FAKE effects that capture the
 * async callbacks so a test can drive the exact interleavings WorldScene sees.
 * They kill the wiring mutations the pure-state tests above cannot reach:
 * dropping the `shouldCapture` consult, bypassing `finishPortal`, capturing
 * under a canceled generation, or sleeping a scene the player re-entered.
 */

/** A captured `() => void` callback the driver handed us; call it to fire. */
function fireVoid(cb: (() => void) | undefined): void {
  // Test-harness guarantee (the driver always registers these in order) —
  // a throwing guard, not `!`, per the repo assertion convention.
  if (!cb) throw new Error("expected the driver to have registered this callback");
  cb();
}

/** A captured snapshot-result callback; call it with the frame (or null). */
function fireResult(
  cb: ((image: string | null) => void) | undefined,
  image: string | null,
): void {
  if (!cb) throw new Error("expected the driver to have registered captureSnapshot");
  cb(image);
}

function makeHarness() {
  let state: PortalCinematic = CINEMATIC_IDLE;
  const ref: CinematicRef = {
    get: () => state,
    set: (next) => {
      state = next;
    },
  };

  let onZoomComplete: (() => void) | undefined;
  let onSnapshotResult: ((image: string | null) => void) | undefined;
  let onTimeout: (() => void) | undefined;

  const calls = { captures: 0, timeouts: 0, sleeps: 0, emits: [] as (string | null)[] };

  const effects: PortalCinematicEffects = {
    startZoom: (cb) => {
      onZoomComplete = cb;
    },
    captureSnapshot: (cb) => {
      calls.captures += 1;
      onSnapshotResult = cb;
    },
    scheduleTimeout: (cb) => {
      calls.timeouts += 1;
      onTimeout = cb;
    },
    emitDone: (image) => {
      calls.emits.push(image);
    },
    sleep: () => {
      calls.sleeps += 1;
    },
  };

  return {
    effects,
    ref,
    calls,
    /** Simulate portalOut / teardown / disconnect advancing the same field. */
    cancel: () => {
      state = cancelPortal(state);
    },
    peekGen: () => state.gen,
    zoomComplete: () => fireVoid(onZoomComplete),
    snapshotLands: (image: string | null) => fireResult(onSnapshotResult, image),
    timeoutFires: () => fireVoid(onTimeout),
  };
}

describe("runPortalCinematic (Phase A sequence wiring)", () => {
  it("happy path: zoom → capture → finish emits once and sleeps once", () => {
    const h = makeHarness();
    runPortalCinematic(h.ref, h.effects);
    h.zoomComplete();
    expect(h.calls.captures).toBe(1); // capture only started after the zoom peaked
    h.snapshotLands("frame-data");
    h.timeoutFires(); // the safety timeout races in afterwards
    expect(h.calls.emits).toEqual(["frame-data"]);
    expect(h.calls.sleeps).toBe(1); // finished at most once despite the race
  });

  it("cancel BEFORE the zoom peaks: never captures, never emits, never sleeps", () => {
    const h = makeHarness();
    runPortalCinematic(h.ref, h.effects);
    h.cancel(); // player stands/Leaves during the zoom
    h.zoomComplete(); // stale zoom-completion callback fires
    expect(h.calls.captures).toBe(0); // shouldCapture gate refused the snapshot
    expect(h.calls.sleeps).toBe(0);
    expect(h.calls.emits).toEqual([]); // scene stays AWAKE
  });

  it("cancel AFTER the zoom, BEFORE the snapshot lands: no late emit, no late sleep", () => {
    const h = makeHarness();
    runPortalCinematic(h.ref, h.effects);
    h.zoomComplete(); // zoom peaked, capture + timeout armed
    expect(h.calls.captures).toBe(1);
    h.cancel(); // portal-out while the renderer snapshot is in flight
    h.snapshotLands("frame-data"); // snapshot callback arrives late
    h.timeoutFires(); // and its safety timeout after that
    expect(h.calls.emits).toEqual([]);
    expect(h.calls.sleeps).toBe(0); // finishPortal gate refused both
  });

  it("timeout path: fires exactly once, and a second finisher cannot double-sleep", () => {
    const h = makeHarness();
    runPortalCinematic(h.ref, h.effects);
    h.zoomComplete();
    h.timeoutFires(); // snapshot lost — safety timeout finishes with null
    h.snapshotLands("frame-data"); // snapshot finally lands afterwards
    expect(h.calls.emits).toEqual([null]); // only the timeout's finish took effect
    expect(h.calls.sleeps).toBe(1);
  });

  it("timeout after a cancel may not finish a dead portal", () => {
    const h = makeHarness();
    runPortalCinematic(h.ref, h.effects);
    h.zoomComplete();
    h.cancel(); // disconnect tears the meeting down mid-cinematic
    h.timeoutFires();
    expect(h.calls.emits).toEqual([]);
    expect(h.calls.sleeps).toBe(0);
  });

  it("re-enter after a cancel: the fresh generation flows and finishes cleanly", () => {
    const h = makeHarness();
    runPortalCinematic(h.ref, h.effects); // gen 1
    h.cancel(); // canceled mid-zoom
    h.zoomComplete(); // stale gen-1 zoom callback — inert
    expect(h.calls.captures).toBe(0);

    runPortalCinematic(h.ref, h.effects); // gen 3 (cancel bumped to 2)
    h.zoomComplete();
    h.snapshotLands("second-frame");
    expect(h.calls.emits).toEqual(["second-frame"]);
    expect(h.calls.sleeps).toBe(1);
  });
});
