/**
 * Pure portal-handoff state machine — the SINGLE home of the portal transition
 * lifecycle, both directions.
 *
 * Portal-IN is a two-phase rendezvous: Phase A is the Phaser side (camera
 * punch-in + fade + frame snapshot + scene sleep); Phase B is the React side
 * (the warp-burst overlay covering the viewport). The meeting grid is revealed
 * exactly once, only when BOTH have signalled — aligning A's final frame with
 * B's mount so there is no gap and no double-flash, whichever finishes first.
 *
 * Portal-OUT is modelled here too, explicitly, so the in/out asymmetry that
 * used to wedge the media queue is gone. A leave that arrives while Phase A is
 * still in flight is a CANCELLATION: it releases the held Phase A media-queue
 * op (`settle`) and runs the exit (`exit`), rather than short-circuiting around
 * the machine. A leave from a fully-open meeting just exits (the queue was
 * already released when A finished). A second leave — double-click, or a
 * defensive `meeting-ended` racing our own `participant-left` — lands on `idle`
 * and is inert.
 *
 * The App shell is pure glue: it feeds events in and enacts the four boolean
 * decisions (`enter`, `reveal`, `settle`, `exit`). No Phaser, DOM, or net here.
 */

export type PortalPhase = "idle" | "entering" | "open";

export interface HandoffState {
  phase: PortalPhase;
  /** Phase A (Phaser cinematic) has completed for the current entry. */
  aDone: boolean;
  /** Phase B (React burst) has covered the viewport for the current entry. */
  bReady: boolean;
}

export type HandoffEvent = "portal-in" | "a-done" | "b-ready" | "portal-out" | "teardown";

export interface HandoffDecision {
  state: HandoffState;
  /** Begin Phaser's Phase A cinematic and arm the held media-queue wait. */
  enter: boolean;
  /** Reveal the meeting grid (Phase A and Phase B have both landed). */
  reveal: boolean;
  /** Release the held Phase A media-queue op (A finished, or entry canceled). */
  settle: boolean;
  /** Run portal-exit: hide the grid and wake the world scene. */
  exit: boolean;
}

export const HANDOFF_IDLE: HandoffState = { phase: "idle", aDone: false, bReady: false };

const NONE = { enter: false, reveal: false, settle: false, exit: false } as const;

export function handoffReduce(state: HandoffState, event: HandoffEvent): HandoffDecision {
  switch (event) {
    case "portal-in": {
      // A fresh entry only from rest; re-entries while entering/open are stale.
      if (state.phase !== "idle") return { state, ...NONE };
      return { state: { phase: "entering", aDone: false, bReady: false }, ...NONE, enter: true };
    }

    case "a-done": {
      // Only meaningful mid-entry; a late completion after leaving is inert.
      if (state.phase !== "entering") return { state, ...NONE };
      const next: HandoffState = { ...state, aDone: true };
      // A always releases the held Phase A op, whether or not B is ready yet.
      if (next.bReady) return { state: { ...next, phase: "open" }, ...NONE, settle: true, reveal: true };
      return { state: next, ...NONE, settle: true };
    }

    case "b-ready": {
      if (state.phase !== "entering") return { state, ...NONE };
      const next: HandoffState = { ...state, bReady: true };
      // B never touches the media queue (it is the React side); reveal iff A done.
      if (next.aDone) return { state: { ...next, phase: "open" }, ...NONE, reveal: true };
      return { state: next, ...NONE };
    }

    case "portal-out": {
      // Idle absorbs a double leave / a meeting-ended trailing our own leave.
      if (state.phase === "idle") return { state, ...NONE };
      // Entering ⇒ cancellation: release the still-held Phase A op. Open ⇒ the
      // op was already released when A finished, so exit without re-settling.
      const settle = state.phase === "entering";
      return { state: HANDOFF_IDLE, ...NONE, settle, exit: true };
    }

    case "teardown": {
      // Unmount: never let the held Phase A op hang, but do not run an exit —
      // the scene is being torn down regardless.
      const settle = state.phase === "entering";
      return { state: HANDOFF_IDLE, ...NONE, settle };
    }
  }
}
