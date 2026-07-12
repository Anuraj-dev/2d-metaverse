import { io, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/db.js";
import {
  api,
  createPlayer,
  expectSilence,
  once,
  onceMatching,
  startServer,
  teardown,
  type TestServer,
} from "./helpers.js";

/**
 * Local mute and persistent block (PRD 25.13). Local mute is client-only and has
 * no server surface; these tests prove the SERVER-owned half: a persistent block
 * filters user-authored world chat and whispers per recipient IN BOTH DIRECTIONS,
 * an unblock restores only future delivery (no backlog replay), and the REST
 * surface is authenticated / self-guarded. Rules are unit-tested in
 * test/blocks.test.ts; this exercises the real REST + socket wiring.
 */
let server: TestServer;
let base: string;
const liveSockets: ClientSocket[] = [];

function connect(token: string): ClientSocket {
  const socket = io(base, { transports: ["websocket"], auth: { token }, reconnection: false });
  liveSockets.push(socket);
  return socket;
}

async function joinAs(token: string): Promise<{ socket: ClientSocket; selfId: string }> {
  const socket = connect(token);
  await once(socket, "connect");
  const init = once<{ selfId: string }>(socket, "init");
  socket.emit("join", { spaceId: "1" });
  return { socket, selfId: (await init).selfId };
}

/** Emit a world line from `author`; resolves once `listener` receives that exact text. */
function expectDelivered(author: ClientSocket, listener: ClientSocket, text: string): Promise<void> {
  const got = onceMatching<{ text: string }>(listener, "chat", (m) => m.text === text);
  author.emit("chat", { text, scope: "world" });
  return got.then(() => undefined);
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

describe("block REST surface", () => {
  it("requires authentication", async () => {
    const target = await createPlayer("blk-auth-t");
    const result = await api(base, "/api/v1/blocks", { body: { targetId: target.id } });
    expect(result.status).toBe(401);
  });

  it("refuses blocking yourself", async () => {
    const me = await createPlayer("blk-self");
    const result = await api(base, "/api/v1/blocks", { token: me.token, body: { targetId: me.id } });
    expect(result.status).toBe(400);
    expect(result.json).toEqual({ error: "cannot-block-self" });
  });

  it("is idempotent and surfaces the requesting player's list", async () => {
    const blocker = await createPlayer("blk-idem-b");
    const target = await createPlayer("blk-idem-t");

    const first = await api(base, "/api/v1/blocks", { token: blocker.token, body: { targetId: target.id } });
    expect(first).toEqual({ status: 201, json: { status: "blocked" } });
    const second = await api(base, "/api/v1/blocks", { token: blocker.token, body: { targetId: target.id } });
    expect(second).toEqual({ status: 200, json: { status: "already-blocked" } });

    const list = await api(base, "/api/v1/blocks", { token: blocker.token });
    expect(list.status).toBe(200);
    expect(list.json.blocked).toContain(target.id);

    // Only one row persisted despite the repeat.
    const rows = await pool.query("SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2", [blocker.id, target.id]);
    expect(rows.rowCount).toBe(1);

    const undo = await api(base, "/api/v1/blocks", { token: blocker.token, method: "DELETE", body: { targetId: target.id } });
    expect(undo).toEqual({ status: 200, json: { status: "unblocked" } });
    const undoAgain = await api(base, "/api/v1/blocks", { token: blocker.token, method: "DELETE", body: { targetId: target.id } });
    expect(undoAgain).toEqual({ status: 200, json: { status: "not-blocked" } });
  });
});

describe("block delivery filtering (both directions)", () => {
  it("suppresses world chat both ways while leaving unrelated players untouched", async () => {
    const a = await createPlayer("blk-a");
    const b = await createPlayer("blk-b");
    const c = await createPlayer("blk-c");
    const A = await joinAs(a.token);
    const B = await joinAs(b.token);
    const C = await joinAs(c.token);

    // Sanity: before any block, A's line reaches B.
    await expectDelivered(A.socket, B.socket, "pre-block-hello");

    const blocked = await api(base, "/api/v1/blocks", { token: a.token, body: { targetId: b.id } });
    expect(blocked.json).toEqual({ status: "blocked" });

    // A → world: B (blocked pair) must NOT receive; C (unrelated) does.
    {
      const cGot = onceMatching<{ text: string }>(C.socket, "chat", (m) => m.text === "from-a-after-block");
      const bSilent = expectSilence(B.socket, "chat", 400, (m) => m.text === "from-a-after-block");
      A.socket.emit("chat", { text: "from-a-after-block", scope: "world" });
      await cGot;
      await bSilent;
    }

    // B → world: A must NOT receive (symmetric); C does.
    {
      const cGot = onceMatching<{ text: string }>(C.socket, "chat", (m) => m.text === "from-b-after-block");
      const aSilent = expectSilence(A.socket, "chat", 400, (m) => m.text === "from-b-after-block");
      B.socket.emit("chat", { text: "from-b-after-block", scope: "world" });
      await cGot;
      await aSilent;
    }
  });

  it("treats a blocked whisper as undeliverable in both directions", async () => {
    const a = await createPlayer("blk-wa");
    const b = await createPlayer("blk-wb");
    const A = await joinAs(a.token);
    const B = await joinAs(b.token);

    await api(base, "/api/v1/blocks", { token: a.token, body: { targetId: b.id } });

    // A → B whisper: A gets whisper-fail, B never receives it.
    {
      const fail = once(A.socket, "whisper-fail");
      const bSilent = expectSilence(B.socket, "whisper", 400);
      A.socket.emit("whisper", { to: b.id, text: "hi b" });
      await fail;
      await bSilent;
    }

    // B → A whisper: symmetric refusal.
    {
      const fail = once(B.socket, "whisper-fail");
      const aSilent = expectSilence(A.socket, "whisper", 400);
      B.socket.emit("whisper", { to: a.id, text: "hi a" });
      await fail;
      await aSilent;
    }
  });

  it("restores only future delivery after unblock (no backlog replay)", async () => {
    const a = await createPlayer("blk-ua");
    const b = await createPlayer("blk-ub");
    const A = await joinAs(a.token);
    const B = await joinAs(b.token);

    await api(base, "/api/v1/blocks", { token: a.token, body: { targetId: b.id } });

    // While blocked, this line is dropped for B — and must not be replayed later.
    {
      const bSilent = expectSilence(B.socket, "chat", 400, (m) => m.text === "during-block");
      A.socket.emit("chat", { text: "during-block", scope: "world" });
      await bSilent;
    }

    await api(base, "/api/v1/blocks", { token: a.token, method: "DELETE", body: { targetId: b.id } });

    // Future lines flow again; the dropped "during-block" line is NOT resent.
    const bGot = onceMatching<{ text: string }>(B.socket, "chat", () => true);
    A.socket.emit("chat", { text: "after-unblock", scope: "world" });
    const line = await bGot;
    expect(line.text).toBe("after-unblock");
  });
});
