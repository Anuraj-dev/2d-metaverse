import { describe, expect, it } from "vitest";
import {
  IDLE_MEETING,
  allSeated,
  meetingTransition,
  type MeetingEvent,
  type MeetingState,
  type RoomMeetingSnapshot,
} from "../src/meeting.js";

/**
 * Exhaustive transition tests for the meeting-start trigger state machine —
 * the single place the meeting-start rules live (see CLAUDE.md). Written from
 * the PRD 10 spec BEFORE any socket wiring:
 *   - starts when every player in the room zone is seated AND count >= 2
 *   - 3s cancelable countdown (cancels on stand or on an unseated entry)
 *   - solo sitter: no portal / no countdown
 *   - latecomer sitting mid-meeting joins in place
 *   - per-person leave on stand; last leaver ends the meeting
 */

const snap = (occupants: string[], seated: string[]): RoomMeetingSnapshot => ({ occupants, seated });

const countdown: MeetingState = { phase: "countdown" };
const active = (...participants: string[]): MeetingState => ({ phase: "active", participants });

const sit = (playerId: string): MeetingEvent => ({ type: "sit", playerId });
const stand = (playerId: string): MeetingEvent => ({ type: "stand", playerId });
const enter = (playerId: string): MeetingEvent => ({ type: "enter", playerId });
const leave = (playerId: string): MeetingEvent => ({ type: "leave", playerId });
const elapsed: MeetingEvent = { type: "countdown-elapsed" };

describe("allSeated predicate", () => {
  it("is false for an empty room", () => {
    expect(allSeated(snap([], []))).toBe(false);
  });
  it("is false for a solo seated occupant (count < 2)", () => {
    expect(allSeated(snap(["a"], ["a"]))).toBe(false);
  });
  it("is true when every occupant is seated and count >= 2", () => {
    expect(allSeated(snap(["a", "b"], ["a", "b"]))).toBe(true);
    expect(allSeated(snap(["a", "b", "c"], ["a", "b", "c"]))).toBe(true);
  });
  it("is false while any occupant is unseated", () => {
    expect(allSeated(snap(["a", "b", "c"], ["a", "b"]))).toBe(false);
  });
  it("tolerates a seated player missing from occupants (disconnect grace)", () => {
    // A seated player whose socket dropped is out of the adapter room but
    // still holds the seat; the remaining occupants being seated suffices.
    expect(allSeated(snap(["a"], ["a", "b"]))).toBe(true);
  });
});

describe("idle", () => {
  it("arms the countdown when the last occupant sits (2 players)", () => {
    const result = meetingTransition(IDLE_MEETING, sit("b"), snap(["a", "b"], ["a", "b"]));
    expect(result.state).toEqual(countdown);
    expect(result.effects).toEqual([{ type: "countdown-started" }]);
  });
  it("arms the countdown when the last of N occupants sits", () => {
    const result = meetingTransition(IDLE_MEETING, sit("d"), snap(["a", "b", "c", "d"], ["a", "b", "c", "d"]));
    expect(result.state).toEqual(countdown);
    expect(result.effects).toEqual([{ type: "countdown-started" }]);
  });
  it("does nothing for a solo sitter (today's behavior, no portal)", () => {
    const result = meetingTransition(IDLE_MEETING, sit("a"), snap(["a"], ["a"]));
    expect(result.state).toEqual(IDLE_MEETING);
    expect(result.effects).toEqual([]);
  });
  it("does nothing when someone sits while an unseated occupant remains", () => {
    const result = meetingTransition(IDLE_MEETING, sit("b"), snap(["a", "b", "c"], ["a", "b"]));
    expect(result.state).toEqual(IDLE_MEETING);
    expect(result.effects).toEqual([]);
  });
  it("arms the countdown when the last unseated occupant walks out over 2 seated", () => {
    const result = meetingTransition(IDLE_MEETING, leave("c"), snap(["a", "b"], ["a", "b"]));
    expect(result.state).toEqual(countdown);
    expect(result.effects).toEqual([{ type: "countdown-started" }]);
  });
  it("stays idle on stand, enter, and a leave that breaks nothing", () => {
    expect(meetingTransition(IDLE_MEETING, stand("a"), snap(["a", "b"], ["b"]))).toEqual({
      state: IDLE_MEETING,
      effects: [],
    });
    expect(meetingTransition(IDLE_MEETING, enter("c"), snap(["a", "b", "c"], ["a", "b"]))).toEqual({
      state: IDLE_MEETING,
      effects: [],
    });
    expect(meetingTransition(IDLE_MEETING, leave("c"), snap(["a"], ["a"]))).toEqual({
      state: IDLE_MEETING,
      effects: [],
    });
  });
  it("ignores a stray countdown-elapsed", () => {
    expect(meetingTransition(IDLE_MEETING, elapsed, snap(["a", "b"], ["a", "b"]))).toEqual({
      state: IDLE_MEETING,
      effects: [],
    });
  });
});

describe("countdown", () => {
  it("keeps counting when a queued stand observes a still-all-seated snapshot", () => {
    const result = meetingTransition(countdown, stand("a"), snap(["a", "b"], ["a", "b"]));
    expect(result.state).toEqual(countdown);
    expect(result.effects).toEqual([]);
  });
  it("cancels when anyone stands", () => {
    const result = meetingTransition(countdown, stand("a"), snap(["a", "b"], ["b"]));
    expect(result.state).toEqual(IDLE_MEETING);
    expect(result.effects).toEqual([{ type: "countdown-canceled", reason: "stand" }]);
  });
  it("keeps counting when a queued enter observes a still-all-seated snapshot", () => {
    const result = meetingTransition(countdown, enter("c"), snap(["a", "b", "c"], ["a", "b", "c"]));
    expect(result.state).toEqual(countdown);
    expect(result.effects).toEqual([]);
  });
  it("cancels when someone enters the room unseated", () => {
    const result = meetingTransition(countdown, enter("c"), snap(["a", "b", "c"], ["a", "b"]));
    expect(result.state).toEqual(IDLE_MEETING);
    expect(result.effects).toEqual([{ type: "countdown-canceled", reason: "unseated-entry" }]);
  });
  it("cancels when a leave breaks the predicate (head-count drops below 2)", () => {
    const result = meetingTransition(countdown, leave("b"), snap(["a"], ["a"]));
    expect(result.state).toEqual(IDLE_MEETING);
    expect(result.effects).toEqual([{ type: "countdown-canceled", reason: "leave" }]);
  });
  it("keeps counting through a leave that preserves the predicate", () => {
    // Three were seated; one's socket-room membership lapses while their seat
    // is still held — the remaining pair is still an all-seated room.
    const result = meetingTransition(countdown, leave("c"), snap(["a", "b"], ["a", "b", "c"]));
    expect(result.state).toEqual(countdown);
    expect(result.effects).toEqual([]);
  });
  it("keeps counting on a redundant sit (no restart)", () => {
    const result = meetingTransition(countdown, sit("a"), snap(["a", "b"], ["a", "b"]));
    expect(result.state).toEqual(countdown);
    expect(result.effects).toEqual([]);
  });
  it("starts the meeting with the seated roster when the countdown elapses", () => {
    const result = meetingTransition(countdown, elapsed, snap(["a", "b", "c"], ["a", "b", "c"]));
    expect(result.state).toEqual(active("a", "b", "c"));
    expect(result.effects).toEqual([{ type: "meeting-started", participants: ["a", "b", "c"] }]);
  });
  it("refuses to start if the predicate no longer holds at the bell (defensive)", () => {
    const result = meetingTransition(countdown, elapsed, snap(["a"], ["a"]));
    expect(result.state).toEqual(IDLE_MEETING);
    expect(result.effects).toEqual([{ type: "countdown-canceled", reason: "leave" }]);
  });
});

describe("active", () => {
  it("joins a latecomer in place when they sit", () => {
    const result = meetingTransition(active("a", "b"), sit("c"), snap(["a", "b", "c"], ["a", "b", "c"]));
    expect(result.state).toEqual(active("a", "b", "c"));
    expect(result.effects).toEqual([{ type: "participant-joined", playerId: "c" }]);
  });
  it("ignores a seat switch by an existing participant", () => {
    const result = meetingTransition(active("a", "b"), sit("a"), snap(["a", "b"], ["a", "b"]));
    expect(result.state).toEqual(active("a", "b"));
    expect(result.effects).toEqual([]);
  });
  it("portals one participant out on stand while the meeting continues", () => {
    const result = meetingTransition(active("a", "b", "c"), stand("b"), snap(["a", "b", "c"], ["a", "c"]));
    expect(result.state).toEqual(active("a", "c"));
    expect(result.effects).toEqual([{ type: "participant-left", playerId: "b" }]);
  });
  it("keeps a lone remaining participant in the meeting (no auto-end at 1)", () => {
    const result = meetingTransition(active("a", "b"), stand("b"), snap(["a", "b"], ["a"]));
    expect(result.state).toEqual(active("a"));
    expect(result.effects).toEqual([{ type: "participant-left", playerId: "b" }]);
  });
  it("ends the meeting when the last participant stands", () => {
    const result = meetingTransition(active("a"), stand("a"), snap(["a"], []));
    expect(result.state).toEqual(IDLE_MEETING);
    expect(result.effects).toEqual([
      { type: "participant-left", playerId: "a" },
      { type: "meeting-ended" },
    ]);
  });
  it("treats a leave (grace expiry / room switch) like a stand", () => {
    const result = meetingTransition(active("a", "b"), leave("a"), snap(["b"], ["b"]));
    expect(result.state).toEqual(active("b"));
    expect(result.effects).toEqual([{ type: "participant-left", playerId: "a" }]);
  });
  it("ends the meeting when the last participant leaves", () => {
    const result = meetingTransition(active("a"), leave("a"), snap([], []));
    expect(result.state).toEqual(IDLE_MEETING);
    expect(result.effects).toEqual([
      { type: "participant-left", playerId: "a" },
      { type: "meeting-ended" },
    ]);
  });
  it("ignores stand/leave by a non-participant and unseated entries", () => {
    expect(meetingTransition(active("a", "b"), stand("z"), snap(["a", "b"], ["a", "b"]))).toEqual({
      state: active("a", "b"),
      effects: [],
    });
    expect(meetingTransition(active("a", "b"), leave("z"), snap(["a", "b"], ["a", "b"]))).toEqual({
      state: active("a", "b"),
      effects: [],
    });
    expect(meetingTransition(active("a", "b"), enter("c"), snap(["a", "b", "c"], ["a", "b"]))).toEqual({
      state: active("a", "b"),
      effects: [],
    });
  });
  it("ignores a stray countdown-elapsed", () => {
    expect(meetingTransition(active("a", "b"), elapsed, snap(["a", "b"], ["a", "b"]))).toEqual({
      state: active("a", "b"),
      effects: [],
    });
  });
  it("never mutates the input state", () => {
    const state = active("a", "b");
    meetingTransition(state, sit("c"), snap(["a", "b", "c"], ["a", "b", "c"]));
    meetingTransition(state, stand("a"), snap(["a", "b"], ["b"]));
    expect(state).toEqual(active("a", "b"));
  });
});

describe("full scenarios", () => {
  const run = (
    start: MeetingState,
    steps: [MeetingEvent, RoomMeetingSnapshot][],
  ): { state: MeetingState; log: string[] } => {
    let state = start;
    const log: string[] = [];
    for (const [event, snapshot] of steps) {
      const result = meetingTransition(state, event, snapshot);
      state = result.state;
      log.push(...result.effects.map((effect) => effect.type));
    }
    return { state, log };
  };

  it("cancel by entry, then re-arm and start once the entrant sits", () => {
    const { state, log } = run(countdown, [
      [enter("c"), snap(["a", "b", "c"], ["a", "b"])],
      [sit("c"), snap(["a", "b", "c"], ["a", "b", "c"])],
      [elapsed, snap(["a", "b", "c"], ["a", "b", "c"])],
    ]);
    expect(state).toEqual(active("a", "b", "c"));
    expect(log).toEqual(["countdown-canceled", "countdown-started", "meeting-started"]);
  });

  it("survives a rapid stand then re-sit and still starts the meeting", () => {
    const { state, log } = run(IDLE_MEETING, [
      [sit("b"), snap(["a", "b"], ["a", "b"])],
      // The queued stand observes the post-resit room, so it must not cancel.
      [stand("a"), snap(["a", "b"], ["a", "b"])],
      [sit("a"), snap(["a", "b"], ["a", "b"])],
      [elapsed, snap(["a", "b"], ["a", "b"])],
    ]);
    expect(state).toEqual(active("a", "b"));
    expect(log).toEqual(["countdown-started", "meeting-started"]);
  });

  it("two sit, meet, one leaves, a latecomer joins, then everyone leaves", () => {
    const { state, log } = run(IDLE_MEETING, [
      [sit("a"), snap(["a"], ["a"])],
      [enter("b"), snap(["a", "b"], ["a"])],
      [sit("b"), snap(["a", "b"], ["a", "b"])],
      [elapsed, snap(["a", "b"], ["a", "b"])],
      [stand("a"), snap(["a", "b"], ["b"])],
      [enter("c"), snap(["a", "b", "c"], ["b"])],
      [sit("c"), snap(["a", "b", "c"], ["b", "c"])],
      [stand("b"), snap(["a", "b", "c"], ["c"])],
      [stand("c"), snap(["a", "b", "c"], [])],
    ]);
    expect(state).toEqual(IDLE_MEETING);
    expect(log).toEqual([
      "countdown-started",
      "meeting-started",
      "participant-left",
      "participant-joined",
      "participant-left",
      "participant-left",
      "meeting-ended",
    ]);
  });
});
