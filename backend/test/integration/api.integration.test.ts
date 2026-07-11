import jwt from "jsonwebtoken";
import { RATE_LIMITS } from "@metaverse/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sitPlayer, standPlayer } from "../../src/seat-store.js";
import { redis } from "../../src/redis.js";
import { api, createUser, startServer, teardown, uniqueName, TEST_PASSWORD, type TestServer } from "./helpers.js";

let server: TestServer;
let base: string;

beforeAll(async () => {
  server = await startServer();
  base = server.baseUrl;
});

afterAll(async () => {
  await teardown(server);
});

describe("signup", () => {
  it("creates a user and returns ok", async () => {
    const result = await api(base, "/api/v1/signup", {
      body: { username: uniqueName("su1"), password: TEST_PASSWORD }
    });
    expect(result).toEqual({ status: 200, json: { ok: true } });
  });

  it("reports a duplicate username as a conflict", async () => {
    const username = uniqueName("su2");
    expect((await api(base, "/api/v1/signup", { body: { username, password: TEST_PASSWORD } })).status).toBe(200);
    const duplicate = await api(base, "/api/v1/signup", { body: { username, password: TEST_PASSWORD } });
    expect(duplicate).toEqual({ status: 409, json: { error: "username-taken" } });
  });

  it("reports malformed signup credentials as validation, never username taken", async () => {
    const short = await api(base, "/api/v1/signup", { body: { username: "ab", password: "short" } });
    expect(short.status).toBe(400);
    expect(short.json).toEqual({ error: "validation" });

    expect((await api(base, "/api/v1/signup", { body: { username: "Bad Chars!", password: TEST_PASSWORD } })).status).toBe(400);
    expect((await api(base, "/api/v1/signup", { body: {} })).status).toBe(400);
  });

  it("reports syntactically invalid signup JSON as validation", async () => {
    const response = await fetch(`${base}/api/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"username":',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "validation" });
  });
});

describe("signin", () => {
  it("returns a verifiable JWT for valid credentials", async () => {
    const { username, token } = await createUser(base, "si1");
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;
    expect(payload.username).toBe(username);
    expect(typeof payload.sub).toBe("string");
  });

  it("rejects a wrong password with 401", async () => {
    const { username } = await createUser(base, "si2");
    const result = await api(base, "/api/v1/signin", { body: { username, password: "wrong-password-123" } });
    expect(result.status).toBe(401);
    expect(result.json.error).toBe("invalid-credentials");
  });

  it("rejects an unknown user with 401", async () => {
    const result = await api(base, "/api/v1/signin", {
      body: { username: uniqueName("ghost"), password: TEST_PASSWORD }
    });
    expect(result.status).toBe(401);
  });
});

describe("space listing", () => {
  it("requires authentication", async () => {
    expect((await api(base, "/api/v1/space/1")).status).toBe(401);
    expect((await api(base, "/api/v1/space/1", { token: "garbage" })).status).toBe(401);
  });

  it("returns the seeded space with six rooms and their seats", async () => {
    const { token } = await createUser(base, "sp1");
    const result = await api(base, "/api/v1/space/1", { token });
    expect(result.status).toBe(200);
    expect(typeof result.json.mapJsonUrl).toBe("string");
    expect(result.json.rooms).toHaveLength(6);
    const room3 = result.json.rooms.find((room: { id: string }) => room.id === "3");
    expect(room3.seats).toHaveLength(12); // hostel Room 3 (PRD 13)
    expect(room3.doorZone).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  });

  it("404s for an unknown space", async () => {
    const { token } = await createUser(base, "sp2");
    expect((await api(base, "/api/v1/space/does-not-exist", { token })).status).toBe(404);
  });
});

describe("livekit token", () => {
  function decodeGrant(livekitToken: string) {
    const payload = jwt.verify(livekitToken, process.env.LIVEKIT_API_SECRET!, {
      issuer: process.env.LIVEKIT_API_KEY
    }) as jwt.JwtPayload & { video: Record<string, unknown> };
    return payload;
  }

  it("issues a mic-only world token bound to the caller's identity", async () => {
    const { token } = await createUser(base, "lk1");
    const result = await api(base, "/api/v1/livekit/token", { token, body: { roomName: "world:1" } });
    expect(result.status).toBe(200);
    expect(typeof result.json.url).toBe("string");
    const payload = decodeGrant(result.json.livekitToken);
    const userId = (jwt.decode(token) as jwt.JwtPayload).sub;
    expect(payload.sub).toBe(userId);
    expect(payload.video).toMatchObject({ room: "world:1", roomJoin: true, canPublish: true, canSubscribe: true });
    const sources = payload.video.canPublishSources as string[];
    expect(sources).toHaveLength(1);
    expect(String(sources[0]).toLowerCase()).toContain("mic");
  });

  it("404s a world token for a missing space", async () => {
    const { token } = await createUser(base, "lk2");
    expect((await api(base, "/api/v1/livekit/token", { token, body: { roomName: "world:nope" } })).status).toBe(404);
  });

  it("denies a room token when not seated and grants it to a seated player with room access", async () => {
    const { token } = await createUser(base, "lk3");
    const userId = (jwt.decode(token) as jwt.JwtPayload).sub!;

    const denied = await api(base, "/api/v1/livekit/token", { token, body: { roomName: "room:1" } });
    expect(denied.status).toBe(403);
    expect(denied.json.error).toBe("seat-required");

    // Mirror the real flow: admission (knock/approve) records access, then
    // seat-sit claims the seat. Both must be present for a room media token.
    const seated = await sitPlayer(userId, "1", 0);
    expect(seated.ok).toBe(true);
    await redis.set(`room-access:${userId}:1`, "1", { EX: 3600 });
    try {
      const granted = await api(base, "/api/v1/livekit/token", { token, body: { roomName: "room:1" } });
      expect(granted.status).toBe(200);
      const payload = decodeGrant(granted.json.livekitToken);
      expect(payload.video).toMatchObject({ room: "room:1", roomJoin: true, canPublish: true });
      // Video allowed in private rooms: no publish-source restriction.
      expect(payload.video.canPublishSources).toBeUndefined();

      // A seat in room 1 must not unlock room 2.
      expect((await api(base, "/api/v1/livekit/token", { token, body: { roomName: "room:2" } })).status).toBe(403);
    } finally {
      await standPlayer(userId);
      await redis.del(`room-access:${userId}:1`);
    }
  });

  it("denies a room token to a seated player who never established room access", async () => {
    // The vulnerability: the seat-claim Lua records only the seat lock, never a
    // room-access grant, and the grant can be revoked while the seat persists.
    // A seat lock without a matching access grant must NOT mint a room token.
    const { token } = await createUser(base, "lk7");
    const userId = (jwt.decode(token) as jwt.JwtPayload).sub!;

    const seated = await sitPlayer(userId, "1", 1);
    expect(seated.ok).toBe(true);
    try {
      const denied = await api(base, "/api/v1/livekit/token", { token, body: { roomName: "room:1" } });
      expect(denied.status).toBe(403);
      expect(denied.json.error).toBe("seat-required");
    } finally {
      await standPlayer(userId);
    }
  });

  it("issues a subscribe-only stage token to the audience", async () => {
    const { token } = await createUser(base, "lk4");
    const result = await api(base, "/api/v1/livekit/token", { token, body: { roomName: "stage:1" } });
    expect(result.status).toBe(200);
    const payload = decodeGrant(result.json.livekitToken);
    expect(payload.video).toMatchObject({ room: "stage:1", roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: false });
  });

  it("denies a stage publish token when the server-known position is off stage", async () => {
    const { token, username } = await createUser(base, "lk5");
    const userId = (jwt.decode(token) as jwt.JwtPayload).sub!;

    // No presence at all → no proof of being on stage.
    const noPos = await api(base, "/api/v1/livekit/token", {
      token,
      body: { roomName: "stage:1", stagePublish: true }
    });
    expect(noPos.status).toBe(403);
    expect(noPos.json.error).toBe("not-on-stage");

    // A known position away from the stage (campus spawn) is still denied.
    await redis.hSet(
      "presence:1",
      userId,
      JSON.stringify({ id: userId, name: username, x: 960, y: 704, dir: "down", connectionId: "test" })
    );
    try {
      const offStage = await api(base, "/api/v1/livekit/token", {
        token,
        body: { roomName: "stage:1", stagePublish: true }
      });
      expect(offStage.status).toBe(403);
      expect(offStage.json.error).toBe("not-on-stage");
    } finally {
      await redis.hDel("presence:1", userId);
    }
  });

  it("grants a publish-capable stage token when the server-known position is on stage", async () => {
    const { token, username } = await createUser(base, "lk8");
    const userId = (jwt.decode(token) as jwt.JwtPayload).sub!;

    // Stage floor centre (stage_zone 1312,256 + 576×448).
    await redis.hSet(
      "presence:1",
      userId,
      JSON.stringify({ id: userId, name: username, x: 1600, y: 480, dir: "down", connectionId: "test" })
    );
    try {
      const granted = await api(base, "/api/v1/livekit/token", {
        token,
        body: { roomName: "stage:1", stagePublish: true }
      });
      expect(granted.status).toBe(200);
      const payload = decodeGrant(granted.json.livekitToken);
      expect(payload.video).toMatchObject({ room: "stage:1", roomJoin: true, canPublish: true, canSubscribe: true });
      // Performer may publish video too (cam for "Go Live"): no source restriction.
      expect(payload.video.canPublishSources).toBeUndefined();
    } finally {
      await redis.hDel("presence:1", userId);
    }
  });

  it("rejects unknown prefixes and malformed bodies with 400", async () => {
    const { token } = await createUser(base, "lk6");
    expect((await api(base, "/api/v1/livekit/token", { token, body: { roomName: "garbage" } })).status).toBe(400);
    expect((await api(base, "/api/v1/livekit/token", { token, body: {} })).status).toBe(400);
    expect((await api(base, "/api/v1/livekit/token", { body: { roomName: "world:1" } })).status).toBe(401);
  });
});

describe("arcade high scores", () => {
  it("requires authentication for submit and leaderboard", async () => {
    expect((await api(base, "/api/v1/arcade/scores/snake")).status).toBe(401);
    expect((await api(base, "/api/v1/arcade/scores", { body: { game: "snake", score: 1 } })).status).toBe(401);
  });

  it("keeps only the best per user and returns it on submit", async () => {
    const { username, token } = await createUser(base, "arc1");
    const first = await api(base, "/api/v1/arcade/scores", { token, body: { game: "snake", score: 12 } });
    expect(first.status).toBe(200);
    expect(first.json.best).toBe(12);
    expect(first.json.game).toBe("snake");
    // A lower score does not lower the stored best.
    const lower = await api(base, "/api/v1/arcade/scores", { token, body: { game: "snake", score: 5 } });
    expect(lower.json.best).toBe(12);
    // A higher score raises it.
    const higher = await api(base, "/api/v1/arcade/scores", { token, body: { game: "snake", score: 20 } });
    expect(higher.json.best).toBe(20);
    // The leaderboard lists this user's best with their username.
    expect(higher.json.top.some((row: { username: string; score: number }) =>
      row.username === username && row.score === 20)).toBe(true);
  });

  it("returns the caller's best (null when unplayed) and a sorted top-N", async () => {
    const { token } = await createUser(base, "arc2");
    const unplayed = await api(base, "/api/v1/arcade/scores/2048", { token });
    expect(unplayed.status).toBe(200);
    expect(unplayed.json.best).toBeNull();
    expect(Array.isArray(unplayed.json.top)).toBe(true);
    await api(base, "/api/v1/arcade/scores", { token, body: { game: "2048", score: 256 } });
    const played = await api(base, "/api/v1/arcade/scores/2048", { token });
    expect(played.json.best).toBe(256);
    const scores = played.json.top.map((row: { score: number }) => row.score);
    expect(scores).toEqual([...scores].sort((a: number, b: number) => b - a));
  });

  it("rejects an unknown game and a malformed score", async () => {
    const { token } = await createUser(base, "arc3");
    expect((await api(base, "/api/v1/arcade/scores/pong", { token })).status).toBe(404);
    const bad = await api(base, "/api/v1/arcade/scores", { token, body: { game: "snake", score: -1 } });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("invalid-score");
  });
});

// Runs LAST: exhausting the limiter poisons /signup and /signin for the rest
// of the 15-minute window (the limiter store is module-scoped in api.ts and
// keyed by IP, which is the same 127.0.0.1 for every request in this suite).
describe("auth rate limiting", () => {
  it("returns a bounded retry outcome within the 40-request window", async () => {
    const body = { username: uniqueName("rate"), password: TEST_PASSWORD };
    const results: Awaited<ReturnType<typeof api>>[] = [];
    for (let attempt = 0; attempt < 41; attempt += 1) {
      results.push(await api(base, "/api/v1/signin", { body }));
    }
    // Earlier tests consumed part of the window, so the flip point varies —
    // but every response is 401/429, a 429 must appear by request 41, and the
    // limiter never un-trips mid-window.
    const statuses = results.map((result) => result.status);
    expect(statuses.every((status) => status === 401 || status === 429)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    const firstLimited = statuses.indexOf(429);
    expect(statuses.slice(firstLimited).every((status) => status === 429)).toBe(true);
    const limited = results.at(-1);
    expect(limited?.json).toMatchObject({
      error: "rate-limited",
      retryAfterSeconds: expect.any(Number),
    });
    expect(limited?.json.retryAfterSeconds).toBeGreaterThan(0);
    expect(limited?.json.retryAfterSeconds).toBeLessThanOrEqual(RATE_LIMITS.authWindowMs / 1000);
  });
});
