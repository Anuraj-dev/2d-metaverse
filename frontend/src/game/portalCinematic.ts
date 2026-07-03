/**
 * Pure decision logic AND sequence wiring for the portal Phase A cinematic
 * (PRD 10, review rounds 2–3). WorldScene is thin glue: it supplies the camera
 * tween, the renderer snapshot, the safety timeout and `scene.sleep()` as
 * injected effects, but every DECISION about whether an async callback is still
 * allowed to act — and the order the effects fire in — lives here. The
 * generation guard (`beginPortal`/`cancelPortal`/`shouldCapture`/`finishPortal`)
 * is the decision layer; `runPortalCinematic` is the effect-injected driver that
 * threads those gates through the zoom→capture→finish sequence.
 *
 * The hazard this module exists to kill: Phase A's callbacks (zoom
 * completion, renderer snapshot, snapshot timeout) fire up to ~750ms after
 * `portalIn`. If the player portals out (stand/Leave/disconnect) or the scene
 * tears down in that window, a stale callback must NOT capture a frame, emit
 * a stale `portal-phase-a-done`, or — worst — `scene.sleep()` a world the
 * player is standing in again (softlock: frozen render loop, movement
 * emission stopped).
 *
 * Mechanism: each `beginPortal` mints a new generation; `cancelPortal`
 * (portal-out, teardown, disconnect) advances the generation WITHOUT starting
 * a cinematic. A callback may act only while the generation it captured is
 * still current, and the finish step runs at most once per generation.
 *
 * Pure module per the scene-as-glue convention: no Phaser, net, or DOM.
 */

export interface PortalCinematic {
  /** Current generation; only callbacks minted under it may act. */
  gen: number;
  /** The current generation's finish (a-done + sleep) already ran. */
  finished: boolean;
}

export const CINEMATIC_IDLE: PortalCinematic = { gen: 0, finished: false };

/** A portal-in begins: invalidate everything older, arm a fresh generation. */
export function beginPortal(state: PortalCinematic): { state: PortalCinematic; gen: number } {
  const gen = state.gen + 1;
  return { state: { gen, finished: false }, gen };
}

/**
 * A portal-out / scene teardown / disconnect: invalidate any in-flight
 * cinematic. Every stale callback (zoom completion, snapshot, timeout) becomes
 * inert — the scene must finish AWAKE.
 */
export function cancelPortal(state: PortalCinematic): PortalCinematic {
  return { gen: state.gen + 1, finished: false };
}

/** May the zoom-completion callback minted under `gen` start the capture? */
export function shouldCapture(state: PortalCinematic, gen: number): boolean {
  return gen === state.gen;
}

/**
 * May the snapshot / timeout callback minted under `gen` finish Phase A
 * (emit `portal-phase-a-done` + `scene.sleep()`)? True at most ONCE per
 * generation — the snapshot result and its safety timeout race, and a stale
 * generation may never finish at all.
 */
export function finishPortal(
  state: PortalCinematic,
  gen: number,
): { state: PortalCinematic; finish: boolean } {
  if (gen !== state.gen || state.finished) return { state, finish: false };
  return { state: { ...state, finished: true }, finish: true };
}

/**
 * A live read/write handle onto the scene's single `PortalCinematic` field.
 * The driver reads it at each async callback (never a stale snapshot) so a
 * `cancelPortal` from `portalOut`/teardown/disconnect — which advances the
 * generation on the SAME field — is observed by callbacks already in flight.
 */
export interface CinematicRef {
  get: () => PortalCinematic;
  set: (state: PortalCinematic) => void;
}

/**
 * The Phaser side-effects the Phase A sequence needs, injected so the wiring
 * (which gate guards which effect, and in what order) is testable without a
 * scene. WorldScene supplies real implementations; tests supply fakes that
 * capture the callbacks and drive the interleavings by hand.
 *
 * - `startZoom(onZoomComplete)` runs the camera punch-in and invokes
 *   `onZoomComplete` exactly when the zoom reaches its peak (progress === 1).
 * - `captureSnapshot(onResult)` snapshots the canvas; `onResult` fires with the
 *   frame (or null on failure) once the async snapshot lands.
 * - `scheduleTimeout(onTimeout)` arms the safety timeout that races the
 *   snapshot so a lost snapshot callback can never wedge Phase A open.
 * - `emitDone(image)` emits `portal-phase-a-done` for the React handoff.
 * - `sleep()` puts the scene to sleep (freezes the render loop for the meeting).
 */
export interface PortalCinematicEffects {
  startZoom: (onZoomComplete: () => void) => void;
  captureSnapshot: (onResult: (image: string | null) => void) => void;
  scheduleTimeout: (onTimeout: () => void) => void;
  emitDone: (image: string | null) => void;
  sleep: () => void;
}

/**
 * The Phase A sequence driver: mint a generation, run the zoom, and — only
 * while that generation is still current — capture a frame, then finish
 * (emit + sleep) at most once as the snapshot and its safety timeout race.
 *
 * Every gate consult lives here, so a wiring mutation (dropping the
 * `shouldCapture` guard, bypassing `finishPortal`, capturing under a canceled
 * generation, sleeping a re-awakened scene) breaks a driver test rather than
 * passing silently. The scene is pure glue that supplies the effects.
 */
export function runPortalCinematic(ref: CinematicRef, effects: PortalCinematicEffects): void {
  const begun = beginPortal(ref.get());
  ref.set(begun.state);
  const gen = begun.gen;

  effects.startZoom(() => {
    // Exit before the zoom peaked (stand/Leave/disconnect advanced the gen):
    // refuse the capture outright — no snapshot, no finish, scene stays awake.
    if (!shouldCapture(ref.get(), gen)) return;

    const finish = (image: string | null) => {
      const decision = finishPortal(ref.get(), gen);
      ref.set(decision.state);
      if (!decision.finish) return; // stale gen, or already finished — do nothing.
      effects.emitDone(image);
      effects.sleep();
    };

    effects.scheduleTimeout(() => finish(null));
    effects.captureSnapshot((image) => finish(image));
  });
}
