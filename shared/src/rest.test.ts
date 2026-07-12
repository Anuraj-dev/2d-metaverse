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
  operationalReportSchema,
  pilotScheduleEntrySchema,
  pilotScheduleSchema,
  presenceSnapshotSchema,
  reportAckSchema,
  reportCreateSchema,
  reportFailureResponseSchema,
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

describe("pilot reliability analytics", () => {
  it("accepts bounded pilot reliability events", () => {
    const parse = (event: unknown) => analyticsIngestRequestSchema.safeParse({
      eventId: "018f47a8-5f63-7c44-9b46-86c2d6e132b1",
      event,
    }).success;
    expect(parse({ name: "world-load", properties: { outcome: "success", durationMs: 1234 } })).toBe(true);
    expect(parse({ name: "reconnect", properties: { outcome: "recovered" } })).toBe(true);
    expect(parse({ name: "media-enable", properties: { kind: "mic", outcome: "success" } })).toBe(true);
    expect(parse({ name: "session-start", properties: {} })).toBe(true);
  });

  it("rejects unbounded reliability payloads", () => {
    const parse = (event: unknown) => analyticsIngestRequestSchema.safeParse({
      eventId: "018f47a8-5f63-7c44-9b46-86c2d6e132b1",
      event,
    }).success;
    expect(parse({ name: "world-load", properties: { outcome: "success", durationMs: 600_001 } })).toBe(false);
    expect(parse({ name: "reconnect", properties: { outcome: "unknown" } })).toBe(false);
    expect(parse({ name: "session-start", properties: { userId: "secret" } })).toBe(false);
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

describe("operational report", () => {
  it("accepts a bounded report per category", () => {
    expect(
      operationalReportSchema.safeParse({ category: "reconnect", reason: "gone", sha: "abc123" }).success,
    ).toBe(true);
    expect(
      operationalReportSchema.safeParse({ category: "media-publish", reason: "denied", sha: "abc123" }).success,
    ).toBe(true);
    expect(
      operationalReportSchema.safeParse({
        category: "auth-transport",
        reason: "unauthorized",
        sha: "abc123",
        url: "/",
        userAgent: "vitest",
        context: "WorldScene",
      }).success,
    ).toBe(true);
  });
  it("rejects an unknown category or a reason from the wrong category", () => {
    expect(operationalReportSchema.safeParse({ category: "chat", reason: "gone", sha: "a" }).success).toBe(false);
    // `denied` is a media reason, not a reconnect reason.
    expect(
      operationalReportSchema.safeParse({ category: "reconnect", reason: "denied", sha: "a" }).success,
    ).toBe(false);
    // `connecting` is a healthy status, never a reportable reconnect reason.
    expect(
      operationalReportSchema.safeParse({ category: "reconnect", reason: "connecting", sha: "a" }).success,
    ).toBe(false);
  });
  it("rejects a missing sha or a free-text reason", () => {
    expect(operationalReportSchema.safeParse({ category: "reconnect", reason: "gone" }).success).toBe(false);
    expect(
      operationalReportSchema.safeParse({ category: "media-publish", reason: "camera exploded", sha: "a" }).success,
    ).toBe(false);
  });
  it("rejects extra keys that could smuggle sensitive content (strictObject)", () => {
    for (const leak of [
      { coordinates: { x: 42.1, y: 88.7 } },
      { sdp: "v=0\no=- 4611731400430051336" },
      { deviceId: "b7c1e...raw-device-id" },
      { transcript: "secret meeting notes" },
      { token: "eyJhbGciOi..." },
    ]) {
      expect(
        operationalReportSchema.safeParse({ category: "reconnect", reason: "gone", sha: "abc123", ...leak }).success,
      ).toBe(false);
    }
  });
});

describe("arcade score submission", () => {
  it("accepts a valid score for a known game", () => {
    expect(arcadeScoreSchema.safeParse({ game: "snake", score: 12 }).success).toBe(true);
    expect(arcadeScoreSchema.safeParse({ game: "flappy", score: 0 }).success).toBe(true);
  });
  it("rejects an unknown game", () => {
    expect(arcadeScoreSchema.safeParse({ game: "pong", score: 1 }).success).toBe(false);
  });
  it("rejects the retired 2048 game id (PRD 25.36)", () => {
    // 2048 was retired: it is no longer in ARCADE_GAMES, so the enum rejects any
    // new submission for it. Stored historical rows keyed on the free-text `game`
    // column are untouched — this only closes the write path.
    expect(arcadeScoreSchema.safeParse({ game: "2048", score: 0 }).success).toBe(false);
  });
  it("rejects a negative, non-integer, or over-cap score", () => {
    expect(arcadeScoreSchema.safeParse({ game: "snake", score: -1 }).success).toBe(false);
    expect(arcadeScoreSchema.safeParse({ game: "snake", score: 1.5 }).success).toBe(false);
    expect(
      arcadeScoreSchema.safeParse({ game: "snake", score: LIMITS.arcadeScoreMax + 1 }).success,
    ).toBe(false);
  });
});

describe("report create request", () => {
  it("accepts a message id + category, with or without a note", () => {
    expect(reportCreateSchema.safeParse({ messageId: "m-1", category: "harassment" }).success).toBe(true);
    expect(
      reportCreateSchema.safeParse({ messageId: "m-1", category: "spam", note: "flooding the room" }).success,
    ).toBe(true);
  });
  it("rejects an unknown category, empty ids, over-long note, and unknown keys", () => {
    expect(reportCreateSchema.safeParse({ messageId: "m-1", category: "banter" }).success).toBe(false);
    expect(reportCreateSchema.safeParse({ messageId: "", category: "spam" }).success).toBe(false);
    expect(
      reportCreateSchema.safeParse({ messageId: "m", category: "spam", note: "x".repeat(LIMITS.reportNoteMax + 1) }).success,
    ).toBe(false);
    // An empty note after trim is not a valid "optional short note".
    expect(reportCreateSchema.safeParse({ messageId: "m", category: "spam", note: "   " }).success).toBe(false);
    // Strict: no forging author/text through extra keys.
    expect(
      reportCreateSchema.safeParse({ messageId: "m", category: "spam", targetId: "victim" }).success,
    ).toBe(false);
  });
});

describe("report responses", () => {
  it("validates created/duplicate acknowledgements and rejects other statuses", () => {
    expect(reportAckSchema.safeParse({ status: "created" }).success).toBe(true);
    expect(reportAckSchema.safeParse({ status: "duplicate" }).success).toBe(true);
    expect(reportAckSchema.safeParse({ status: "pending" }).success).toBe(false);
  });
  it("validates coarse failure variants", () => {
    expect(reportFailureResponseSchema.safeParse({ error: "message-not-found" }).success).toBe(true);
    expect(reportFailureResponseSchema.safeParse({ error: "cannot-report-self" }).success).toBe(true);
    expect(reportFailureResponseSchema.safeParse({ error: "rate-limited", retryAfterSeconds: 30 }).success).toBe(true);
    expect(reportFailureResponseSchema.safeParse({ error: "rate-limited" }).success).toBe(false);
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
