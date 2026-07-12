/**
 * Moderator review + reversible action end-to-end (PRD 25.14). Exercises the
 * public REST/socket surface only (no direct handler calls): the allowlist gate,
 * the review actions, and — the load-bearing part — that a suspension actually
 * denies signin, drops a live socket, and refuses a media token, then that a
 * reversal restores every one of those.
 */
import { io, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { issueToken } from "../../src/auth.js";
import { pool } from "../../src/db.js";
import { hashSecret } from "../../src/password.js";
import {
  TEST_PASSWORD,
  api,
  once,
  startServer,
  teardown,
  uniqueName,
  type TestServer,
} from "./helpers.js";

// Must equal MODERATOR_USER_IDS in setup.ts — this is the ONLY source of authority.
const MODERATOR_ID = "0abc0abc-0abc-4abc-8abc-0abc0abc0abc";

let server: TestServer;
let base: string;
const liveSockets: ClientSocket[] = [];

function connect(token: string): ClientSocket {
  const socket = io(base, { transports: ["websocket"], auth: { token }, reconnection: false });
  liveSockets.push(socket);
  return socket;
}

/** Create the allowlisted moderator user (fixed id) + a signin-capable password. */
async function createModerator(): Promise<{ id: string; username: string; token: string }> {
  const username = uniqueName("mod");
  await pool.query(
    `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, password_hash = EXCLUDED.password_hash`,
    [MODERATOR_ID, username, await hashSecret(TEST_PASSWORD)],
  );
  return { id: MODERATOR_ID, username, token: issueToken({ id: MODERATOR_ID, username }) };
}

/** A regular (non-allowlisted) user created directly, with a real password + token. */
async function createRegular(prefix: string): Promise<{ id: string; username: string; token: string }> {
  const username = uniqueName(prefix);
  const inserted = await pool.query<{ id: string }>(
    "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
    [username, await hashSecret(TEST_PASSWORD)],
  );
  const id = inserted.rows[0]!.id;
  return { id, username, token: issueToken({ id, username }) };
}

beforeAll(async () => {
  server = await startServer();
  base = server.baseUrl;
});

afterEach(() => {
  for (const socket of liveSockets.splice(0)) socket.disconnect();
});

afterAll(async () => {
  await teardown(server);
});

describe("moderator authorization (PRD 25.14)", () => {
  it("hides the moderator surface from anonymous and non-moderator callers (uniform 404)", async () => {
    const regular = await createRegular("nonmod");
    const anon = await api(base, "/api/v1/mod/reports");
    expect(anon.status).toBe(404);
    expect(anon.json).toEqual({ error: "not-found" });

    const asRegular = await api(base, "/api/v1/mod/reports", { token: regular.token });
    expect(asRegular.status).toBe(404);
    expect(asRegular.json).toEqual({ error: "not-found" });

    // A non-moderator cannot suspend either — same uniform 404, no route leak.
    const suspendAttempt = await api(base, "/api/v1/mod/suspend", {
      token: regular.token,
      body: { targetId: regular.id, until: Date.now() + 60_000 },
    });
    expect(suspendAttempt.status).toBe(404);
  });

  it("lets an allowlisted moderator reach the surface", async () => {
    const mod = await createModerator();
    const list = await api(base, "/api/v1/mod/reports", { token: mod.token });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.json.reports)).toBe(true);
  });
});

describe("report review (PRD 25.14)", () => {
  it("lists an open report and dismisses it", async () => {
    const mod = await createModerator();
    const reporter = await createRegular("rep");
    const target = await createRegular("tgt");
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO reports (reporter_id, target_id, message_id, message_text, scope, category)
       VALUES ($1, $2, $3, 'hello world', 'world', 'spam') RETURNING id`,
      [reporter.id, target.id, uniqueName("msg")],
    );
    const reportId = rows[0]!.id;

    const list = await api(base, "/api/v1/mod/reports", { token: mod.token });
    expect(list.status).toBe(200);
    const found = (list.json.reports as Array<{ id: string; targetId: string; status: string }>).find(
      (r) => r.id === reportId,
    );
    expect(found?.targetId).toBe(target.id);
    expect(found?.status).toBe("open");

    const dismiss = await api(base, `/api/v1/mod/reports/${reportId}/dismiss`, {
      token: mod.token,
      method: "POST",
    });
    expect(dismiss.status).toBe(200);
    expect(dismiss.json).toEqual({ ok: true });

    // It leaves the open queue, and the row is marked dismissed + reviewed.
    const after = await api(base, "/api/v1/mod/reports", { token: mod.token });
    expect((after.json.reports as Array<{ id: string }>).some((r) => r.id === reportId)).toBe(false);
    const { rows: check } = await pool.query<{ status: string; reviewed_by: string }>(
      "SELECT status, reviewed_by FROM reports WHERE id = $1",
      [reportId],
    );
    expect(check[0]?.status).toBe("dismissed");
    expect(check[0]?.reviewed_by).toBe(mod.id);
  });

  it("404s dismissing a non-existent report", async () => {
    const mod = await createModerator();
    const missing = await api(base, "/api/v1/mod/reports/11111111-1111-4111-8111-111111111111/dismiss", {
      token: mod.token,
      method: "POST",
    });
    expect(missing.status).toBe(404);
  });
});

describe("warn (PRD 25.14)", () => {
  it("records a warning and audits it", async () => {
    const mod = await createModerator();
    const target = await createRegular("warn");
    const warn = await api(base, "/api/v1/mod/warn", {
      token: mod.token,
      body: { targetId: target.id, reason: "please be kind" },
    });
    expect(warn.status).toBe(200);
    expect(warn.json).toEqual({ ok: true });

    const { rows } = await pool.query<{ action: string }>(
      "SELECT action FROM moderation_actions WHERE target_id = $1 AND action = 'warn'",
      [target.id],
    );
    expect(rows.length).toBe(1);
  });

  it("404s warning an unknown target", async () => {
    const mod = await createModerator();
    const res = await api(base, "/api/v1/mod/warn", {
      token: mod.token,
      body: { targetId: "99999999-9999-4999-8999-999999999999" },
    });
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: "target-not-found" });
  });
});

describe("suspend + reverse enforcement (PRD 25.14)", () => {
  it("suspends: denies signin, drops the live socket, refuses a media token — then unsuspend restores all", async () => {
    const mod = await createModerator();
    // Direct insert with the shared test password so the target can sign in.
    const target = await createRegular("susp");

    // Live socket, joined space 1 (registers it in activeSockets for the drop).
    const socket = connect(target.token);
    const init = once(socket, "init");
    await once(socket, "connect");
    socket.emit("join", { spaceId: "1" });
    await init;
    expect(socket.connected).toBe(true);

    // Pre-suspension a media token is granted.
    const tokenBefore = await api(base, "/api/v1/livekit/token", {
      token: target.token,
      body: { roomName: "world:1" },
    });
    expect(tokenBefore.status).toBe(200);

    const until = Date.now() + 60 * 60_000;
    const disconnected = once(socket, "disconnect");
    const suspend = await api(base, "/api/v1/mod/suspend", {
      token: mod.token,
      body: { targetId: target.id, until, reason: "cooling off" },
    });
    expect(suspend.status).toBe(200);
    expect(suspend.json).toEqual({ ok: true });

    // 1. The live socket is dropped immediately.
    await disconnected;
    expect(socket.connected).toBe(false);

    // 2. Signin is denied with a bounded suspended failure carrying the expiry.
    const signin = await api(base, "/api/v1/signin", {
      body: { username: target.username, password: TEST_PASSWORD },
    });
    expect(signin.status).toBe(403);
    expect(signin.json.error).toBe("suspended");
    expect(signin.json.until).toBe(until);

    // 3. A media token is refused (existing JWT still valid, access gated).
    const tokenDuring = await api(base, "/api/v1/livekit/token", {
      token: target.token,
      body: { roomName: "world:1" },
    });
    expect(tokenDuring.status).toBe(403);
    expect(tokenDuring.json.error).toBe("suspended");

    // 4. A fresh socket connection is refused at the handshake.
    const blocked = connect(target.token);
    const connErr = await once<Error>(blocked, "connect_error");
    expect(connErr.message).toBe("suspended");

    // Reverse it.
    const unsuspend = await api(base, "/api/v1/mod/unsuspend", {
      token: mod.token,
      body: { targetId: target.id },
    });
    expect(unsuspend.status).toBe(200);

    // Access restored: signin works, media token granted, socket connects.
    const signinAfter = await api(base, "/api/v1/signin", {
      body: { username: target.username, password: TEST_PASSWORD },
    });
    expect(signinAfter.status).toBe(200);
    expect(typeof signinAfter.json.token).toBe("string");

    const tokenAfter = await api(base, "/api/v1/livekit/token", {
      token: signinAfter.json.token as string,
      body: { roomName: "world:1" },
    });
    expect(tokenAfter.status).toBe(200);

    const reconnected = connect(target.token);
    await once(reconnected, "connect");
    expect(reconnected.connected).toBe(true);
  });

  it("rejects a suspend timestamp that is not in the future", async () => {
    const mod = await createModerator();
    const target = await createRegular("past");
    const res = await api(base, "/api/v1/mod/suspend", {
      token: mod.token,
      body: { targetId: target.id, until: Date.now() - 1000 },
    });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: "invalid-until" });
  });
});
