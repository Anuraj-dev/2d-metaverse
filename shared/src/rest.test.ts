import { describe, expect, it } from "vitest";
import {
  arcadeLeaderboardSchema,
  arcadeScoreSchema,
  analyticsIngestRequestSchema,
  analyticsIngestFailureSchema,
  analyticsIngestResponseSchema,
  authFailureResponseSchema,
  clientErrorSchema,
  credentialsSchema,
  liveKitSchema,
  pilotScheduleEntrySchema,
  pilotScheduleSchema,
  presenceSnapshotSchema,
  spaceInfoSchema,
} from "./rest.js";
import { LIMITS } from "./constants.js";

describe("credentials", () => {
  it("accepts and normalises a valid username", () => {
    // .parse throws on failure, so a valid credential returns the normalised data.
    const parsed = credentialsSchema.parse({ username: "  Alice_1  ", password: "hunter2!!" });
    expect(parsed.username).toBe("alice_1");
  });
  it("rejects a short username or password", () => {
    expect(credentialsSchema.safeParse({ username: "ab", password: "hunter2!!" }).success).toBe(false);
    expect(credentialsSchema.safeParse({ username: "alice", password: "short" }).success).toBe(false);
  });
  it("rejects disallowed username characters", () => {
    expect(credentialsSchema.safeParse({ username: "bad name", password: "hunter2!!" }).success).toBe(false);
  });
});

describe("auth failure response", () => {
  it("accepts only the bounded public auth outcomes", () => {
    expect(authFailureResponseSchema.safeParse({ error: "validation" }).success).toBe(true);
    expect(authFailureResponseSchema.safeParse({ error: "username-taken" }).success).toBe(true);
    expect(authFailureResponseSchema.safeParse({ error: "invalid-credentials" }).success).toBe(true);
    expect(
      authFailureResponseSchema.safeParse({ error: "rate-limited", retryAfterSeconds: 60 }).success,
    ).toBe(true);
    expect(authFailureResponseSchema.safeParse({ error: "server-error" }).success).toBe(true);
    expect(authFailureResponseSchema.safeParse({ error: "database exploded" }).success).toBe(false);
    expect(
      authFailureResponseSchema.safeParse({
        error: "validation",
        details: { password: ["hunter2"] },
      }).success,
    ).toBe(false);
  });
});

describe("analytics ingestion", () => {
  it("accepts only an allowlisted, bounded post-auth event envelope", () => {
    const event = {
      eventId: "018f47a8-5f63-7c44-9b46-86c2d6e132b1",
      event: {
        name: "ingestion-probe",
        properties: { nonce: "018f47a8-5f63-7c44-9b46-86c2d6e132b2" },
      },
    };

    expect(analyticsIngestRequestSchema.safeParse(event).success).toBe(true);
    expect(
      analyticsIngestRequestSchema.safeParse({ ...event, event: { name: "password-captured" } }).success,
    ).toBe(false);
    expect(
      analyticsIngestRequestSchema.safeParse({ ...event, event: { name: "session-started" } }).success,
    ).toBe(false);
    expect(
      analyticsIngestRequestSchema.safeParse({
        ...event,
        username: "alice",
        password: "secret123",
        actorUserId: "018f47a8-5f63-7c44-9b46-86c2d6e132b1",
        occurredAt: "2026-07-11T12:34:56.000Z",
      }).success,
    ).toBe(false);
  });

  it("validates the server-stamped idempotent acknowledgement", () => {
    expect(
      analyticsIngestResponseSchema.safeParse({
        acceptedAt: "2026-07-11T12:34:56.000Z",
        duplicate: false,
      }).success,
    ).toBe(true);
    expect(
      analyticsIngestResponseSchema.safeParse({ acceptedAt: Date.now(), duplicate: false }).success,
    ).toBe(false);
    expect(analyticsIngestFailureSchema.safeParse({ error: "invalid-event" }).success).toBe(true);
    expect(analyticsIngestFailureSchema.safeParse({ error: "event-id-conflict" }).success).toBe(true);
    expect(
      analyticsIngestFailureSchema.safeParse({ error: "rate-limited", retryAfterSeconds: 60 }).success,
    ).toBe(true);
    expect(analyticsIngestFailureSchema.safeParse({ error: "unaudited-event" }).success).toBe(false);
  });

  it("accepts the social-arrival events with only bounded, identity-free properties", () => {
    const envelope = (event: unknown) => ({
      eventId: "018f47a8-5f63-7c44-9b46-86c2d6e132b1",
      event,
    });
    expect(
      analyticsIngestRequestSchema.safeParse(
        envelope({ name: "social-arrival-viewed", properties: { onlineCount: 7, activeSpaces: 2, hasSchedule: true } }),
      ).success,
    ).toBe(true);
    expect(
      analyticsIngestRequestSchema.safeParse(
        envelope({ name: "presence-locate", properties: { targetKind: "meeting" } }),
      ).success,
    ).toBe(true);
    // Counts are bounded and negatives rejected.
    expect(
      analyticsIngestRequestSchema.safeParse(
        envelope({ name: "social-arrival-viewed", properties: { onlineCount: -1, activeSpaces: 0, hasSchedule: false } }),
      ).success,
    ).toBe(false);
    // No identity leakage: extra keys (a username/target id) are rejected by strictObject.
    expect(
      analyticsIngestRequestSchema.safeParse(
        envelope({ name: "presence-locate", properties: { targetKind: "room", targetId: "alice" } }),
      ).success,
    ).toBe(false);
    // "world" and "arcade" are not locate targets in the read model's active spaces,
    // but "world" is a valid presence kind; arcade is not observable so it is rejected.
    expect(
      analyticsIngestRequestSchema.safeParse(
        envelope({ name: "presence-locate", properties: { targetKind: "arcade" } }),
      ).success,
    ).toBe(false);
  });
});

describe("pilot schedule", () => {
  const entry = {
    id: "welcome-week",
    title: "Welcome mixer",
    startsAt: "2026-07-11T17:00:00.000Z",
    endsAt: "2026-07-11T18:00:00.000Z",
    activityId: "room:commons",
    description: "Say hi at the commons.",
  };

  it("accepts a well-formed entry and rejects a backwards interval", () => {
    expect(pilotScheduleEntrySchema.safeParse(entry).success).toBe(true);
    expect(pilotScheduleEntrySchema.safeParse({ ...entry, description: undefined }).success).toBe(true);
    expect(
      pilotScheduleEntrySchema.safeParse({ ...entry, endsAt: "2026-07-11T16:00:00.000Z" }).success,
    ).toBe(false);
  });

  it("rejects an over-long title and unknown keys, and validates an array", () => {
    expect(pilotScheduleEntrySchema.safeParse({ ...entry, title: "x".repeat(LIMITS.scheduleTitleMax + 1) }).success).toBe(false);
    expect(pilotScheduleEntrySchema.safeParse({ ...entry, secret: "x" }).success).toBe(false);
    expect(pilotScheduleSchema.safeParse([entry]).success).toBe(true);
    expect(pilotScheduleSchema.safeParse([]).success).toBe(true);
  });
});

describe("presence snapshot", () => {
  it("accepts a populated read model and rejects an unobservable arcade activity", () => {
    const snapshot = {
      spaceId: "1",
      people: [
        { id: "a", name: "alice", activity: "world", place: null },
        { id: "b", name: "bob", activity: "meeting", place: "Commons" },
      ],
      activeSpaces: [{ kind: "meeting", id: "room:commons", label: "Commons", count: 2 }],
      nextScheduled: null,
    };
    expect(presenceSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      presenceSnapshotSchema.safeParse({
        ...snapshot,
        people: [{ id: "a", name: "alice", activity: "arcade", place: null }],
      }).success,
    ).toBe(false);
    // activeSpaces never describes the open world.
    expect(
      presenceSnapshotSchema.safeParse({
        ...snapshot,
        activeSpaces: [{ kind: "world", id: "x", label: "Campus", count: 1 }],
      }).success,
    ).toBe(false);
  });
});

describe("livekit token request", () => {
  it("accepts a room name with an optional stage-publish flag", () => {
    expect(liveKitSchema.safeParse({ roomName: "world:1" }).success).toBe(true);
    expect(liveKitSchema.safeParse({ roomName: "stage:1", stagePublish: true }).success).toBe(true);
  });
  it("rejects an empty room name", () => {
    expect(liveKitSchema.safeParse({ roomName: "" }).success).toBe(false);
  });
});

describe("client error report", () => {
  it("accepts a minimal report", () => {
    expect(clientErrorSchema.safeParse({ message: "boom", sha: "abc123" }).success).toBe(true);
  });
  it("rejects a missing sha or an over-long message", () => {
    expect(clientErrorSchema.safeParse({ message: "boom" }).success).toBe(false);
    expect(
      clientErrorSchema.safeParse({ message: "x".repeat(LIMITS.clientErrorMessageMax + 1), sha: "abc" }).success,
    ).toBe(false);
  });
});

describe("arcade score submission", () => {
  it("accepts a valid score for a known game", () => {
    expect(arcadeScoreSchema.safeParse({ game: "snake", score: 12 }).success).toBe(true);
    expect(arcadeScoreSchema.safeParse({ game: "2048", score: 0 }).success).toBe(true);
  });
  it("rejects an unknown game", () => {
    expect(arcadeScoreSchema.safeParse({ game: "pong", score: 1 }).success).toBe(false);
  });
  it("rejects a negative, non-integer, or over-cap score", () => {
    expect(arcadeScoreSchema.safeParse({ game: "snake", score: -1 }).success).toBe(false);
    expect(arcadeScoreSchema.safeParse({ game: "snake", score: 1.5 }).success).toBe(false);
    expect(
      arcadeScoreSchema.safeParse({ game: "snake", score: LIMITS.arcadeScoreMax + 1 }).success,
    ).toBe(false);
  });
});

describe("arcade leaderboard response", () => {
  it("validates a leaderboard with a null personal best", () => {
    const board = { game: "flappy", top: [{ username: "alice", score: 9 }], best: null };
    expect(arcadeLeaderboardSchema.safeParse(board).success).toBe(true);
  });
  it("rejects a non-integer score in a row", () => {
    const bad = { game: "flappy", top: [{ username: "a", score: 1.2 }], best: 3 };
    expect(arcadeLeaderboardSchema.safeParse(bad).success).toBe(false);
  });
});

describe("space info response", () => {
  it("validates a space with a room and seats", () => {
    const space = {
      mapJsonUrl: "/assets/maps/campus.json",
      rooms: [
        {
          id: "1",
          name: "Room 1",
          doorZone: { x: 0, y: 0, width: 32, height: 32 },
          seats: [{ id: 0, x: 10, y: 10, facing: "down" }],
        },
      ],
    };
    expect(spaceInfoSchema.safeParse(space).success).toBe(true);
  });
  it("rejects a seat with an invalid facing", () => {
    const bad = {
      mapJsonUrl: "/m.json",
      rooms: [
        {
          id: "1",
          name: "Room 1",
          doorZone: { x: 0, y: 0, width: 1, height: 1 },
          seats: [{ id: 0, x: 0, y: 0, facing: "sideways" }],
        },
      ],
    };
    expect(spaceInfoSchema.safeParse(bad).success).toBe(false);
  });
});
