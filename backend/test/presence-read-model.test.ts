import { describe, expect, it } from "vitest";
import {
  STAGE_PLACE_LABEL,
  STAGE_SPACE_ID,
  buildPresenceSnapshot,
  type PresenceReadModelInput,
} from "../src/presence-read-model.js";
import type { PilotScheduleEntry } from "@metaverse/shared";

/**
 * Table-driven tests for the pure social-arrival read model (PRD 25.26). These
 * pin the "who is where" rules independent of Redis/Socket.IO: activity
 * precedence, active-space aggregation, determinism, and the truthfulness rule
 * that only server-observable activities are reported.
 */

const base: PresenceReadModelInput = {
  spaceId: "1",
  online: [],
  rooms: [],
  boards: [],
  stageOccupantIds: [],
  nextScheduled: null,
};

const person = (id: string, name: string) => ({ id, name, x: 0, y: 0 });

describe("buildPresenceSnapshot — activity per student", () => {
  it("places a free-roaming student in the open world with no place", () => {
    const snap = buildPresenceSnapshot({ ...base, online: [person("a", "alice")] });
    expect(snap.people).toEqual([{ id: "a", name: "alice", activity: "world", place: null }]);
    expect(snap.activeSpaces).toEqual([]);
  });

  it("reports room vs meeting from the room's live-meeting flag", () => {
    const snap = buildPresenceSnapshot({
      ...base,
      online: [person("a", "alice"), person("b", "bob")],
      rooms: [
        { id: "r1", label: "Commons", occupants: ["a"], meetingActive: true },
        { id: "r2", label: "Studio", occupants: ["b"], meetingActive: false },
      ],
    });
    expect(snap.people).toEqual([
      { id: "a", name: "alice", activity: "meeting", place: "Commons" },
      { id: "b", name: "bob", activity: "room", place: "Studio" },
    ]);
  });

  it("reports a seated board player and a stage-zone student", () => {
    const snap = buildPresenceSnapshot({
      ...base,
      online: [person("a", "alice"), person("b", "bob")],
      boards: [{ id: "ttt-1", label: "Tic-Tac-Toe", seated: ["a"] }],
      stageOccupantIds: ["b"],
    });
    expect(snap.people).toEqual([
      { id: "a", name: "alice", activity: "board", place: "Tic-Tac-Toe" },
      { id: "b", name: "bob", activity: "stage", place: STAGE_PLACE_LABEL },
    ]);
  });

  it("applies precedence meeting > room > board > stage for one student", () => {
    // A student seated in a room with a live meeting who is also (impossibly, per
    // geometry) listed on a board + stage resolves to the highest precedence.
    const snap = buildPresenceSnapshot({
      ...base,
      online: [person("a", "alice")],
      rooms: [{ id: "r1", label: "Commons", occupants: ["a"], meetingActive: true }],
      boards: [{ id: "ttt-1", label: "Tic-Tac-Toe", seated: ["a"] }],
      stageOccupantIds: ["a"],
    });
    expect(snap.people[0]?.activity).toBe("meeting");
  });
});

describe("buildPresenceSnapshot — active spaces", () => {
  it("lists only non-empty spaces, never the open world, sorted deterministically", () => {
    const snap = buildPresenceSnapshot({
      ...base,
      online: [person("a", "alice"), person("b", "bob"), person("c", "cara")],
      rooms: [
        { id: "r1", label: "Studio", occupants: ["a"], meetingActive: false },
        { id: "r2", label: "Commons", occupants: ["b"], meetingActive: true },
        { id: "r3", label: "Empty", occupants: [], meetingActive: false },
      ],
      boards: [{ id: "ttt-1", label: "Tic-Tac-Toe", seated: ["c"] }],
      stageOccupantIds: [],
    });
    expect(snap.activeSpaces).toEqual([
      { kind: "meeting", id: "r2", label: "Commons", count: 1 },
      { kind: "room", id: "r1", label: "Studio", count: 1 },
      { kind: "board", id: "ttt-1", label: "Tic-Tac-Toe", count: 1 },
    ]);
  });

  it("adds the stage as a single active space when anyone is on it", () => {
    const snap = buildPresenceSnapshot({
      ...base,
      online: [person("a", "alice"), person("b", "bob")],
      stageOccupantIds: ["a", "b"],
    });
    expect(snap.activeSpaces).toEqual([
      { kind: "stage", id: STAGE_SPACE_ID, label: STAGE_PLACE_LABEL, count: 2 },
    ]);
  });
});

describe("buildPresenceSnapshot — schedule + determinism", () => {
  it("passes the next scheduled activity through untouched", () => {
    const next: PilotScheduleEntry = {
      id: "welcome",
      title: "Welcome mixer",
      startsAt: "2026-07-11T17:00:00.000Z",
      endsAt: "2026-07-11T18:00:00.000Z",
      activityId: "room:commons",
    };
    const snap = buildPresenceSnapshot({ ...base, nextScheduled: next });
    expect(snap.nextScheduled).toEqual(next);
  });

  it("sorts people by name so equal inputs produce equal snapshots", () => {
    const snap = buildPresenceSnapshot({
      ...base,
      online: [person("z", "zoe"), person("a", "amy"), person("m", "mo")],
    });
    expect(snap.people.map((p) => p.name)).toEqual(["amy", "mo", "zoe"]);
  });
});
