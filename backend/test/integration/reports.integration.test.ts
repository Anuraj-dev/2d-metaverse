import { io, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/db.js";
import { api, createPlayer, once, startServer, teardown, type TestServer } from "./helpers.js";

/**
 * Report ingestion + moderation trail (PRD 25.12). The crux: a report binds
 * actor/target/message from the SERVER's own snapshot of a broadcast chat line —
 * the reporter supplies only the server-stamped messageId + category, and forged
 * or expired context is refused. Persistence, dedupe, authz, and privacy of the
 * stored snapshot are all exercised through the real REST + socket interfaces.
 */
let server: TestServer;
let base: string;
const liveSockets: ClientSocket[] = [];

function connect(token: string): ClientSocket {
  const socket = io(base, { transports: ["websocket"], auth: { token }, reconnection: false });
  liveSockets.push(socket);
  return socket;
}

async function joinAs(token: string) {
  const socket = connect(token);
  await once(socket, "connect");
  const init = once<{ selfId: string }>(socket, "init");
  socket.emit("join", { spaceId: "1" });
  await init;
  return socket;
}

/**
 * Have `authorToken`'s player say `text` in world chat and return the server's
 * stamped identity for that line, captured off a second listener's socket.
 */
async function sayAndCapture(
  authorToken: string,
  listener: ClientSocket,
  text: string,
): Promise<{ id: string; messageId: string; text: string }> {
  const author = await joinAs(authorToken);
  const received = once<{ id: string; messageId: string; text: string }>(listener, "chat");
  author.emit("chat", { text, scope: "world" });
  return received;
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

describe("POST /api/v1/reports", () => {
  it("requires authentication", async () => {
    const result = await api(base, "/api/v1/reports", { body: { messageId: "x", category: "spam" } });
    expect(result.status).toBe(401);
  });

  it("rejects a malformed body as validation", async () => {
    const reporter = await createPlayer("rep-val");
    const result = await api(base, "/api/v1/reports", {
      token: reporter.token,
      body: { messageId: "x", category: "banter" },
    });
    expect(result.status).toBe(400);
    expect(result.json).toEqual({ error: "validation" });
  });

  it("refuses a forged / unknown messageId", async () => {
    const reporter = await createPlayer("rep-forge");
    const result = await api(base, "/api/v1/reports", {
      token: reporter.token,
      body: { messageId: "never-broadcast", category: "harassment" },
    });
    expect(result.status).toBe(404);
    expect(result.json).toEqual({ error: "message-not-found" });
  });

  it("binds actor/target/text server-side, persisting the smallest justified snapshot", async () => {
    const author = await createPlayer("rep-author");
    const reporter = await createPlayer("rep-reporter");
    const listener = await joinAs(reporter.token);
    const line = await sayAndCapture(author.token, listener, "an abusive line");
    expect(line.id).toBe(author.id); // server-stamped author, not client-supplied

    const result = await api(base, "/api/v1/reports", {
      token: reporter.token,
      // The reporter cannot forge author or text — only the id + reason is sent.
      body: { messageId: line.messageId, category: "harassment", note: "please review" },
    });
    expect(result.status).toBe(201);
    expect(result.json).toEqual({ status: "created" });

    const row = await pool.query<{ reporter_id: string; target_id: string; message_text: string; category: string; note: string }>(
      "SELECT reporter_id, target_id, message_text, category, note FROM reports WHERE message_id = $1",
      [line.messageId],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0]).toMatchObject({
      reporter_id: reporter.id,
      target_id: author.id, // bound from the snapshot, never the reporter
      message_text: "an abusive line", // authoritative server text
      category: "harassment",
      note: "please review",
    });
  });

  it("refuses reporting your own message", async () => {
    const author = await createPlayer("rep-self");
    const self = await joinAs(author.token);
    const line = await sayAndCapture(author.token, self, "my own words");
    const result = await api(base, "/api/v1/reports", {
      token: author.token,
      body: { messageId: line.messageId, category: "spam" },
    });
    expect(result.status).toBe(400);
    expect(result.json).toEqual({ error: "cannot-report-self" });
    const row = await pool.query("SELECT 1 FROM reports WHERE message_id = $1", [line.messageId]);
    expect(row.rowCount).toBe(0);
  });

  it("dedupes a repeat report from the same reporter idempotently", async () => {
    const author = await createPlayer("rep-dup-a");
    const reporter = await createPlayer("rep-dup-r");
    const listener = await joinAs(reporter.token);
    const line = await sayAndCapture(author.token, listener, "spammy spammy");

    const first = await api(base, "/api/v1/reports", {
      token: reporter.token,
      body: { messageId: line.messageId, category: "spam" },
    });
    expect(first).toEqual({ status: 201, json: { status: "created" } });

    const second = await api(base, "/api/v1/reports", {
      token: reporter.token,
      body: { messageId: line.messageId, category: "hate" },
    });
    expect(second).toEqual({ status: 200, json: { status: "duplicate" } });

    const rows = await pool.query("SELECT 1 FROM reports WHERE reporter_id = $1 AND message_id = $2", [reporter.id, line.messageId]);
    expect(rows.rowCount).toBe(1); // only the first record survives
  });
});
