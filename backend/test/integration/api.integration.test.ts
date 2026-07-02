import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sitPlayer, standPlayer } from "../../src/seat-store.js";
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

  it("rejects a duplicate username with 400 username-taken", async () => {
    const username = uniqueName("su2");
    expect((await api(base, "/api/v1/signup", { body: { username, password: TEST_PASSWORD } })).status).toBe(200);
    const duplicate = await api(base, "/api/v1/signup", { body: { username, password: TEST_PASSWORD } });
    expect(duplicate.status).toBe(400);
    expect(duplicate.json.error).toBe("username-taken");
  });

  it("rejects malformed credentials with 400 and field details", async () => {
    const short = await api(base, "/api/v1/signup", { body: { username: "ab", password: "short" } });
    expect(short.status).toBe(400);
    expect(short.json.error).toBe("invalid-credentials");
    expect(short.json.details).toBeDefined();

    expect((await api(base, "/api/v1/signup", { body: { username: "Bad Chars!", password: TEST_PASSWORD } })).status).toBe(400);
    expect((await api(base, "/api/v1/signup", { body: {} })).status).toBe(400);
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
    expect(room3.seats).toHaveLength(4);
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

  it("denies a room token when not seated and grants it when seated", async () => {
    const { token } = await createUser(base, "lk3");
    const userId = (jwt.decode(token) as jwt.JwtPayload).sub!;

    const denied = await api(base, "/api/v1/livekit/token", { token, body: { roomName: "room:1" } });
    expect(denied.status).toBe(403);
    expect(denied.json.error).toBe("seat-required");

    const seated = await sitPlayer(userId, "1", 0);
    expect(seated.ok).toBe(true);
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
    }
  });

  it("issues a subscribe-only stage token to the audience", async () => {
    const { token } = await createUser(base, "lk4");
    const result = await api(base, "/api/v1/livekit/token", { token, body: { roomName: "stage:1" } });
    expect(result.status).toBe(200);
    const payload = decodeGrant(result.json.livekitToken);
    expect(payload.video).toMatchObject({ room: "stage:1", roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: false });
  });

  it("gates the stage presenter grant on STAGE_KEY", async () => {
    const { token } = await createUser(base, "lk5");
    const bad = await api(base, "/api/v1/livekit/token", {
      token,
      body: { roomName: "stage:1", presenterKey: "wrong-key" }
    });
    expect(bad.status).toBe(403);
    expect(bad.json.error).toBe("bad-presenter-key");

    const good = await api(base, "/api/v1/livekit/token", {
      token,
      body: { roomName: "stage:1", presenterKey: process.env.STAGE_KEY }
    });
    expect(good.status).toBe(200);
    const payload = decodeGrant(good.json.livekitToken);
    expect(payload.video).toMatchObject({ room: "stage:1", canPublish: true });
    expect(payload.video.canPublishSources).toBeUndefined();
  });

  it("rejects unknown prefixes and malformed bodies with 400", async () => {
    const { token } = await createUser(base, "lk6");
    expect((await api(base, "/api/v1/livekit/token", { token, body: { roomName: "garbage" } })).status).toBe(400);
    expect((await api(base, "/api/v1/livekit/token", { token, body: {} })).status).toBe(400);
    expect((await api(base, "/api/v1/livekit/token", { body: { roomName: "world:1" } })).status).toBe(401);
  });
});

// Runs LAST: exhausting the limiter poisons /signup and /signin for the rest
// of the 15-minute window (the limiter store is module-scoped in api.ts and
// keyed by IP, which is the same 127.0.0.1 for every request in this suite).
describe("auth rate limiting", () => {
  it("returns 429 within the 40-request window and keeps rejecting after", async () => {
    const body = { username: "x", password: "y" }; // cheap 401s — no scrypt work
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 41; attempt += 1) {
      statuses.push((await api(base, "/api/v1/signin", { body })).status);
    }
    // Earlier tests consumed part of the window, so the flip point varies —
    // but every response is 401/429, a 429 must appear by request 41, and the
    // limiter never un-trips mid-window.
    expect(statuses.every((status) => status === 401 || status === 429)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    const firstLimited = statuses.indexOf(429);
    expect(statuses.slice(firstLimited).every((status) => status === 429)).toBe(true);
  });
});
