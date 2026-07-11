import { describe, expect, it } from "vitest";
import {
  arcadeLeaderboardSchema,
  arcadeScoreSchema,
  authFailureResponseSchema,
  clientErrorSchema,
  credentialsSchema,
  liveKitSchema,
  operationalReportSchema,
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
