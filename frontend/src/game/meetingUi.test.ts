import { describe, expect, it } from "vitest";
import { MEETING_NONE, meetingUiReduce, type MeetingUiState } from "./meetingUi";

const SELF = "me";
const me = { id: SELF, name: "self" };
const alice = { id: "a", name: "alice" };
const bob = { id: "b", name: "bob" };

const countdownState: MeetingUiState = {
  status: "countdown",
  roomId: "1",
  durationMs: 3000,
  participants: [me, alice],
};
const inMeeting = (...participants: { id: string; name: string }[]): MeetingUiState => ({
  status: "in-meeting",
  roomId: "1",
  participants,
});

describe("meetingUiReduce", () => {
  it("shows the countdown when the room announces one", () => {
    const result = meetingUiReduce(MEETING_NONE, SELF, {
      type: "meeting-countdown",
      payload: { roomId: "1", durationMs: 3000, participants: [me, alice] },
    });
    expect(result).toEqual({ state: countdownState, action: "none" });
  });

  it("clears the countdown on cancellation without any portal", () => {
    const result = meetingUiReduce(countdownState, SELF, {
      type: "meeting-countdown-canceled",
      payload: { roomId: "1", reason: "stand" },
    });
    expect(result).toEqual({ state: MEETING_NONE, action: "none" });
  });

  it("ignores a cancellation for another room", () => {
    const result = meetingUiReduce(countdownState, SELF, {
      type: "meeting-countdown-canceled",
      payload: { roomId: "2", reason: "stand" },
    });
    expect(result).toEqual({ state: countdownState, action: "none" });
  });

  it("portals in when the meeting starts with self on the roster", () => {
    const result = meetingUiReduce(countdownState, SELF, {
      type: "meeting-started",
      payload: { roomId: "1", participants: [me, alice] },
    });
    expect(result).toEqual({ state: inMeeting(me, alice), action: "portal-in" });
  });

  it("never portals in on a meeting-started that does not include self", () => {
    const result = meetingUiReduce(MEETING_NONE, SELF, {
      type: "meeting-started",
      payload: { roomId: "1", participants: [alice, bob] },
    });
    expect(result).toEqual({ state: MEETING_NONE, action: "none" });
  });

  it("portals in as a latecomer on own participant-joined (with the full roster)", () => {
    const result = meetingUiReduce(MEETING_NONE, SELF, {
      type: "meeting-participant-joined",
      payload: { roomId: "1", participant: me, participants: [alice, bob, me] },
    });
    expect(result).toEqual({ state: inMeeting(alice, bob, me), action: "portal-in" });
  });

  it("updates the roster (no portal) when someone else joins mid-meeting", () => {
    const result = meetingUiReduce(inMeeting(me, alice), SELF, {
      type: "meeting-participant-joined",
      payload: { roomId: "1", participant: bob, participants: [me, alice, bob] },
    });
    expect(result).toEqual({ state: inMeeting(me, alice, bob), action: "none" });
  });

  it("portals out on own participant-left while others remain", () => {
    const result = meetingUiReduce(inMeeting(me, alice), SELF, {
      type: "meeting-participant-left",
      payload: { roomId: "1", playerId: SELF },
    });
    expect(result).toEqual({ state: MEETING_NONE, action: "portal-out" });
  });

  it("drops a departed remote from the roster without portalling", () => {
    const result = meetingUiReduce(inMeeting(me, alice), SELF, {
      type: "meeting-participant-left",
      payload: { roomId: "1", playerId: "a" },
    });
    expect(result).toEqual({ state: inMeeting(me), action: "none" });
  });

  it("treats meeting-ended after own exit as a no-op (last-leaver ordering)", () => {
    // Server sends participant-left(self) then meeting-ended; by the time
    // ended arrives we are already out — no second portal.
    const afterLeft = meetingUiReduce(inMeeting(me), SELF, {
      type: "meeting-participant-left",
      payload: { roomId: "1", playerId: SELF },
    });
    expect(afterLeft.action).toBe("portal-out");
    const afterEnded = meetingUiReduce(afterLeft.state, SELF, {
      type: "meeting-ended",
      payload: { roomId: "1" },
    });
    expect(afterEnded).toEqual({ state: MEETING_NONE, action: "none" });
  });

  it("defensively portals out if meeting-ended arrives while still in the meeting", () => {
    const result = meetingUiReduce(inMeeting(me, alice), SELF, {
      type: "meeting-ended",
      payload: { roomId: "1" },
    });
    expect(result).toEqual({ state: MEETING_NONE, action: "portal-out" });
  });

  it("ignores meeting events for other rooms while in a meeting", () => {
    const state = inMeeting(me, alice);
    const joined = meetingUiReduce(state, SELF, {
      type: "meeting-participant-joined",
      payload: { roomId: "2", participant: bob, participants: [bob] },
    });
    expect(joined).toEqual({ state, action: "none" });
    const left = meetingUiReduce(state, SELF, {
      type: "meeting-participant-left",
      payload: { roomId: "2", playerId: "a" },
    });
    expect(left).toEqual({ state, action: "none" });
    const ended = meetingUiReduce(state, SELF, {
      type: "meeting-ended",
      payload: { roomId: "2" },
    });
    // Ended for a different room clears nothing we own… but we were never in
    // room 2, so our state is untouched only if roomIds mismatch is respected.
    expect(ended.action).toBe("none");
  });
});
