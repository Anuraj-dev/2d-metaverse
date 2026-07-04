import { describe, expect, it } from "vitest";
import { HANDOFF_IDLE, handoffReduce, type HandoffState } from "./portalHandoff";

/**
 * The portal-handoff machine now models the FULL transition lifecycle in one
 * place — portal-IN (Phase A / Phase B rendezvous, reveal-once) AND portal-OUT
 * (with cancellation of an in-flight entry). The in/out asymmetry that let a
 * pending Phase A settle wedge the media queue is gone: every decision the App
 * shell needs (arm the cinematic, reveal the grid, release the queued Phase A
 * wait, run the exit) is a pure output of this reducer.
 */
describe("portal handoff machine", () => {
  const entering = (over: Partial<HandoffState> = {}): HandoffState => ({
    phase: "entering",
    aDone: false,
    bReady: false,
    ...over,
  });

  it("starts idle and arms the cinematic on portal-in", () => {
    const d = handoffReduce(HANDOFF_IDLE, "portal-in");
    expect(d.state).toEqual(entering());
    expect(d).toMatchObject({ enter: true, reveal: false, settle: false, exit: false });
  });

  it("ignores a second portal-in while already entering", () => {
    const d = handoffReduce(entering({ aDone: true }), "portal-in");
    expect(d.state).toEqual(entering({ aDone: true }));
    expect(d.enter).toBe(false);
  });

  // ---- reveal-once: Phase A / Phase B rendezvous ---------------------------
  it("reveals when A finishes after B is ready (B-first ordering)", () => {
    const afterB = handoffReduce(entering(), "b-ready");
    expect(afterB).toMatchObject({ reveal: false, settle: false });
    expect(afterB.state).toEqual(entering({ bReady: true }));
    const afterA = handoffReduce(afterB.state, "a-done");
    expect(afterA).toMatchObject({ reveal: true, settle: true });
    expect(afterA.state.phase).toBe("open");
  });

  it("reveals when B mounts after A finished (A-first ordering)", () => {
    const afterA = handoffReduce(entering(), "a-done");
    // A always releases the held Phase A media-queue op, even before reveal.
    expect(afterA).toMatchObject({ reveal: false, settle: true });
    expect(afterA.state).toEqual(entering({ aDone: true }));
    const afterB = handoffReduce(afterA.state, "b-ready");
    expect(afterB).toMatchObject({ reveal: true, settle: false });
    expect(afterB.state.phase).toBe("open");
  });

  it("never reveals twice on duplicate rendezvous events", () => {
    let state = handoffReduce(entering(), "a-done").state;
    const open = handoffReduce(state, "b-ready");
    expect(open.reveal).toBe(true);
    state = open.state;
    for (const event of ["a-done", "b-ready"] as const) {
      const again = handoffReduce(state, event);
      expect(again.reveal).toBe(false);
      expect(again.state.phase).toBe("open");
    }
  });

  it("ignores rendezvous events while idle (no portal in flight)", () => {
    for (const event of ["a-done", "b-ready"] as const) {
      const d = handoffReduce(HANDOFF_IDLE, event);
      expect(d).toMatchObject({ reveal: false, settle: false, exit: false, enter: false });
      expect(d.state).toEqual(HANDOFF_IDLE);
    }
  });

  // ---- portal-OUT + cancellation ------------------------------------------
  it("leaving during Phase A (before any rendezvous) cancels: settles the queue and exits", () => {
    const d = handoffReduce(entering(), "portal-out");
    expect(d).toMatchObject({ settle: true, exit: true, reveal: false, enter: false });
    expect(d.state).toEqual(HANDOFF_IDLE);
  });

  it("leaving after A finished but before reveal still settles + exits once", () => {
    const d = handoffReduce(entering({ aDone: true }), "portal-out");
    expect(d).toMatchObject({ settle: true, exit: true });
    expect(d.state).toEqual(HANDOFF_IDLE);
  });

  it("leaving a fully-open meeting exits without re-settling (queue already released)", () => {
    const open: HandoffState = { phase: "open", aDone: true, bReady: true };
    const d = handoffReduce(open, "portal-out");
    expect(d).toMatchObject({ exit: true, settle: false, reveal: false });
    expect(d.state).toEqual(HANDOFF_IDLE);
  });

  it("a double leave is a no-op the second time (idle absorbs it)", () => {
    const first = handoffReduce({ phase: "open", aDone: true, bReady: true }, "portal-out");
    expect(first.exit).toBe(true);
    const second = handoffReduce(first.state, "portal-out");
    expect(second).toMatchObject({ exit: false, settle: false });
    expect(second.state).toEqual(HANDOFF_IDLE);
  });

  it("meeting-ended racing our own leave: the trailing portal-out is inert", () => {
    // meetingUi emits portal-out on participant-left(self); a defensive
    // meeting-ended right behind it maps to another portal-out from idle.
    const afterLeave = handoffReduce({ phase: "open", aDone: true, bReady: true }, "portal-out");
    const trailing = handoffReduce(afterLeave.state, "portal-out");
    expect(trailing).toMatchObject({ exit: false, settle: false });
  });

  it("a stale a-done arriving after we left is inert (no reveal, no exit)", () => {
    const left = handoffReduce(entering({ aDone: false }), "portal-out").state;
    const stale = handoffReduce(left, "a-done");
    expect(stale).toMatchObject({ reveal: false, settle: false, exit: false, enter: false });
    expect(stale.state).toEqual(HANDOFF_IDLE);
  });

  // ---- teardown ------------------------------------------------------------
  it("teardown while entering releases the pending Phase A wait without exiting", () => {
    const d = handoffReduce(entering({ aDone: true }), "teardown");
    expect(d).toMatchObject({ settle: true, exit: false, reveal: false });
    expect(d.state).toEqual(HANDOFF_IDLE);
  });

  it("teardown while idle or open is a settle-free no-op", () => {
    for (const state of [HANDOFF_IDLE, { phase: "open", aDone: true, bReady: true } as const]) {
      const d = handoffReduce(state, "teardown");
      expect(d).toMatchObject({ settle: false, exit: false });
      expect(d.state).toEqual(HANDOFF_IDLE);
    }
  });
});
