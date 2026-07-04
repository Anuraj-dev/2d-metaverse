import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pino } from "pino";
import { createMeetingManager, type MeetingManager } from "../src/meeting-manager.js";
import type { RoomMeetingSnapshot } from "../src/meeting.js";

/**
 * The manager is the side-effect shell around the pure machine (meeting.ts,
 * exhaustively tested separately): these tests cover what only the shell owns
 * — the countdown timer lifecycle, effect → broadcast payload translation,
 * and per-room dispatch serialization.
 */

const COUNTDOWN_MS = 500;
const ROOM = "room-1";

interface Broadcast {
  roomId: string;
  event: string;
  payload: unknown;
}

/** One per-participant delivery (meeting-chat fan-out). */
interface Send {
  playerId: string;
  event: string;
  payload: unknown;
}

function makeManager(names: Record<string, string> = { a: "alice", b: "bob", c: "carol" }): {
  manager: MeetingManager;
  broadcasts: Broadcast[];
  sends: Send[];
  setSnapshot: (snapshot: RoomMeetingSnapshot) => void;
} {
  const broadcasts: Broadcast[] = [];
  const sends: Send[] = [];
  let snapshot: RoomMeetingSnapshot = { occupants: [], seated: [] };
  const manager = createMeetingManager({
    countdownMs: COUNTDOWN_MS,
    getSnapshot: (roomId) => {
      expect(roomId).toBe(ROOM);
      return Promise.resolve(snapshot);
    },
    resolveName: (playerId) => names[playerId] ?? playerId,
    broadcast: (roomId, event, ...payload) => broadcasts.push({ roomId, event, payload: payload[0] }),
    sendToPlayer: (playerId, event, ...payload) => sends.push({ playerId, event, payload: payload[0] }),
    log: pino({ level: "silent" }),
  });
  return {
    manager,
    broadcasts,
    sends,
    setSnapshot: (next) => {
      snapshot = next;
    },
  };
}

describe("meeting manager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("broadcasts a countdown with roster + durationMs, then meeting-started when the timer elapses", async () => {
    const { manager, broadcasts, setSnapshot } = makeManager();
    setSnapshot({ occupants: ["a", "b"], seated: ["a", "b"] });
    manager.dispatch(ROOM, { type: "sit", playerId: "b" });
    await manager.settle();

    expect(broadcasts).toEqual([
      {
        roomId: ROOM,
        event: "meeting-countdown",
        payload: {
          roomId: ROOM,
          durationMs: COUNTDOWN_MS,
          participants: [
            { id: "a", name: "alice" },
            { id: "b", name: "bob" },
          ],
        },
      },
    ]);

    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
    await manager.settle();
    expect(broadcasts[1]).toEqual({
      roomId: ROOM,
      event: "meeting-started",
      payload: {
        roomId: ROOM,
        participants: [
          { id: "a", name: "alice" },
          { id: "b", name: "bob" },
        ],
      },
    });
  });

  it("a stand during the countdown cancels it and the timer never fires", async () => {
    const { manager, broadcasts, setSnapshot } = makeManager();
    setSnapshot({ occupants: ["a", "b"], seated: ["a", "b"] });
    manager.dispatch(ROOM, { type: "sit", playerId: "b" });
    await manager.settle();

    setSnapshot({ occupants: ["a", "b"], seated: ["b"] });
    manager.dispatch(ROOM, { type: "stand", playerId: "a" });
    await manager.settle();

    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 4);
    await manager.settle();

    expect(broadcasts.map((broadcast) => broadcast.event)).toEqual([
      "meeting-countdown",
      "meeting-countdown-canceled",
    ]);
    expect(broadcasts[1]?.payload).toEqual({ roomId: ROOM, reason: "stand" });
  });

  it("an unseated entry cancels with reason unseated-entry", async () => {
    const { manager, broadcasts, setSnapshot } = makeManager();
    setSnapshot({ occupants: ["a", "b"], seated: ["a", "b"] });
    manager.dispatch(ROOM, { type: "sit", playerId: "b" });
    await manager.settle();

    setSnapshot({ occupants: ["a", "b", "c"], seated: ["a", "b"] });
    manager.dispatch(ROOM, { type: "enter", playerId: "c" });
    await manager.settle();

    expect(broadcasts[1]).toEqual({
      roomId: ROOM,
      event: "meeting-countdown-canceled",
      payload: { roomId: ROOM, reason: "unseated-entry" },
    });
  });

  it("a latecomer's sit broadcasts participant-joined with the post-join roster", async () => {
    const { manager, broadcasts, setSnapshot } = makeManager();
    setSnapshot({ occupants: ["a", "b"], seated: ["a", "b"] });
    manager.dispatch(ROOM, { type: "sit", playerId: "b" });
    await manager.settle();
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
    await manager.settle();

    setSnapshot({ occupants: ["a", "b", "c"], seated: ["a", "b", "c"] });
    manager.dispatch(ROOM, { type: "sit", playerId: "c" });
    await manager.settle();

    expect(broadcasts[2]).toEqual({
      roomId: ROOM,
      event: "meeting-participant-joined",
      payload: {
        roomId: ROOM,
        participant: { id: "c", name: "carol" },
        participants: [
          { id: "a", name: "alice" },
          { id: "b", name: "bob" },
          { id: "c", name: "carol" },
        ],
      },
    });
  });

  it("the last leaver produces participant-left then meeting-ended", async () => {
    const { manager, broadcasts, setSnapshot } = makeManager();
    setSnapshot({ occupants: ["a", "b"], seated: ["a", "b"] });
    manager.dispatch(ROOM, { type: "sit", playerId: "b" });
    await manager.settle();
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
    await manager.settle();

    setSnapshot({ occupants: ["a", "b"], seated: ["b"] });
    manager.dispatch(ROOM, { type: "stand", playerId: "a" });
    setSnapshot({ occupants: ["a", "b"], seated: [] });
    manager.dispatch(ROOM, { type: "stand", playerId: "b" });
    await manager.settle();

    expect(broadcasts.map((broadcast) => broadcast.event)).toEqual([
      "meeting-countdown",
      "meeting-started",
      "meeting-participant-left",
      "meeting-participant-left",
      "meeting-ended",
    ]);
  });

  it("serializes racing dispatches per room (no interleaved transitions)", async () => {
    const broadcasts: Broadcast[] = [];
    const snapshots: RoomMeetingSnapshot[] = [
      { occupants: ["a", "b"], seated: ["a", "b"] }, // after b sits
      { occupants: ["a", "b", "c"], seated: ["a", "b"] }, // after c enters
    ];
    const manager = createMeetingManager({
      countdownMs: COUNTDOWN_MS,
      // Each dequeued dispatch consumes the next post-event snapshot; a
      // non-serialized manager would read them out of order.
      getSnapshot: () => {
        const next = snapshots.shift();
        if (!next) throw new Error("more dispatches than snapshots");
        return Promise.resolve(next);
      },
      resolveName: (playerId) => playerId,
      broadcast: (roomId, event, ...payload) => broadcasts.push({ roomId, event, payload: payload[0] }),
      sendToPlayer: () => {},
      log: pino({ level: "silent" }),
    });

    manager.dispatch(ROOM, { type: "sit", playerId: "b" });
    manager.dispatch(ROOM, { type: "enter", playerId: "c" });
    await manager.settle();

    expect(broadcasts.map((broadcast) => broadcast.event)).toEqual([
      "meeting-countdown",
      "meeting-countdown-canceled",
    ]);
  });

  describe("in-meeting chat", () => {
    /** Drive a room to a live meeting of [a, b]. */
    async function startMeeting(manager: MeetingManager, setSnapshot: (s: RoomMeetingSnapshot) => void) {
      setSnapshot({ occupants: ["a", "b"], seated: ["a", "b"] });
      manager.dispatch(ROOM, { type: "sit", playerId: "b" });
      await manager.settle();
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
      await manager.settle();
    }

    it("relays a participant's line to every participant (sender included), named", async () => {
      const { manager, sends, setSnapshot } = makeManager();
      await startMeeting(manager, setSnapshot);

      manager.chat(ROOM, "a", "hello team");
      await manager.settle();

      expect(sends).toEqual([
        { playerId: "a", event: "meeting-chat", payload: { roomId: ROOM, id: "a", name: "alice", text: "hello team" } },
        { playerId: "b", event: "meeting-chat", payload: { roomId: ROOM, id: "a", name: "alice", text: "hello team" } },
      ]);
    });

    it("drops a line from a non-participant even if they share the room zone", async () => {
      const { manager, sends, setSnapshot } = makeManager();
      await startMeeting(manager, setSnapshot);

      // "c" is an unseated occupant (never joined the meeting) — no delivery.
      manager.chat(ROOM, "c", "let me in");
      await manager.settle();

      expect(sends).toEqual([]);
    });

    it("drops a line when no meeting is live in the room", async () => {
      const { manager, sends, setSnapshot } = makeManager();
      setSnapshot({ occupants: ["a"], seated: ["a"] });
      manager.dispatch(ROOM, { type: "sit", playerId: "a" });
      await manager.settle();

      manager.chat(ROOM, "a", "anyone here?");
      await manager.settle();

      expect(sends).toEqual([]);
    });

    it("stops relaying once the meeting has ended", async () => {
      const { manager, sends, setSnapshot } = makeManager();
      await startMeeting(manager, setSnapshot);

      setSnapshot({ occupants: ["a", "b"], seated: ["b"] });
      manager.dispatch(ROOM, { type: "stand", playerId: "a" });
      setSnapshot({ occupants: ["a", "b"], seated: [] });
      manager.dispatch(ROOM, { type: "stand", playerId: "b" });
      await manager.settle();

      manager.chat(ROOM, "b", "wait");
      await manager.settle();

      expect(sends).toEqual([]);
    });

    it("a chat racing a queued stand is gated on post-transition state, not the stale roster", async () => {
      const { manager, sends, setSnapshot } = makeManager();
      await startMeeting(manager, setSnapshot);

      // Dispatch a's stand and — WITHOUT awaiting the queue drain — chat both
      // from the departing player and from the remaining one. A chat gate that
      // reads room state synchronously sees the stale [a, b] roster: a's line
      // would deliver, and b's line would still reach a.
      setSnapshot({ occupants: ["a", "b"], seated: ["b"] });
      manager.dispatch(ROOM, { type: "stand", playerId: "a" });
      manager.chat(ROOM, "a", "one last word");
      manager.chat(ROOM, "b", "still here");
      await manager.settle();

      // Once the queue settles, the departed player neither delivers nor
      // receives: a's line is dropped, b's line reaches only b.
      expect(sends).toEqual([
        { playerId: "b", event: "meeting-chat", payload: { roomId: ROOM, id: "b", name: "bob", text: "still here" } },
      ]);
    });
  });
});
