/**
 * Pure decision logic for the portal Phase A cinematic's generation guard
 * (PRD 10, review round 2). WorldScene is thin glue: it runs the camera
 * tween, the renderer snapshot and `scene.sleep()`, but every DECISION about
 * whether an async callback is still allowed to act lives here.
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
