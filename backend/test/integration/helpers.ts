/**
 * Shared plumbing for the integration suite. Boots the real app in-process on
 * an ephemeral port (same wiring as production via createServer()) against the
 * services configured in setup.ts.
 */
import type { AddressInfo } from "node:net";
import type { Socket as ClientSocket } from "socket.io-client";
import { createServer } from "../../src/app.js";
import { issueToken } from "../../src/auth.js";
import { pool } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";
import { hashSecret } from "../../src/password.js";
import { redis } from "../../src/redis.js";
import { seed } from "../../src/seed.js";

const runId = `it${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

/** Unique lowercase username for this run; cleaned up by deleteRunUsers(). */
export function uniqueName(prefix: string): string {
  return `${runId}_${prefix}`.toLowerCase().slice(0, 32);
}

export interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * Prepare the schema and seed data (both idempotent), flush the dedicated
 * Redis test DB, and boot the app on an ephemeral port. Callers own close().
 */
export async function startServer(): Promise<TestServer> {
  if (!redis.isOpen) await redis.connect();
  await redis.flushDb(); // never assume clean state — logical DB 1 is ours
  await migrate();
  await seed();
  const { server, io } = createServer();
  const baseUrl = await new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
  return {
    baseUrl,
    close: async () => {
      void io.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

/** Delete every user created by this run and disconnect the shared clients. */
export async function teardown(server?: TestServer): Promise<void> {
  await pool.query("DELETE FROM users WHERE username LIKE $1", [`${runId}\\_%`]);
  if (server) await server.close();
  if (redis.isOpen) await redis.flushDb();
  if (redis.isOpen) await redis.quit();
  await pool.end();
}

export interface ApiResult {
  status: number;
  json: any;
}

export async function api(
  baseUrl: string,
  path: string,
  options: { token?: string; body?: unknown; method?: string } = {}
): Promise<ApiResult> {
  const { token, body, method = body ? "POST" : "GET" } = options;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

export const TEST_PASSWORD = "integration-password-123";

/** Sign a user up through the real REST API and return their JWT. */
export async function createUser(baseUrl: string, prefix: string): Promise<{ username: string; token: string }> {
  const username = uniqueName(prefix);
  const signup = await api(baseUrl, "/api/v1/signup", { body: { username, password: TEST_PASSWORD } });
  if (signup.status !== 200) throw new Error(`signup failed for ${username}: ${signup.status}`);
  const signin = await api(baseUrl, "/api/v1/signin", { body: { username, password: TEST_PASSWORD } });
  if (signin.status !== 200) throw new Error(`signin failed for ${username}: ${signin.status}`);
  return { username, token: signin.json.token as string };
}

let sharedHash: Promise<string> | undefined;

/**
 * Create a user directly in Postgres and mint their JWT with the server's own
 * signer. Sidesteps the REST auth limiter (40 requests / 15 min / IP shared
 * per process) so socket suites can create many players; the REST paths get
 * their own dedicated coverage in the API suite.
 */
export async function createPlayer(prefix: string): Promise<{ id: string; username: string; token: string }> {
  sharedHash ??= hashSecret(TEST_PASSWORD);
  const username = uniqueName(prefix);
  const inserted = await pool.query<{ id: string }>(
    "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
    [username, await sharedHash]
  );
  const id = inserted.rows[0]!.id;
  return { id, username, token: issueToken({ id, username }) };
}

/** Await one emission of an event, failing loudly on timeout. */
export function once<T = any>(socket: ClientSocket, event: string, timeoutMs = 3_000): Promise<T> {
  return onceMatching(socket, event, () => true, timeoutMs);
}

/**
 * Await the first emission of an event whose payload satisfies the predicate,
 * ignoring the rest. Needed where late grace-timers from a previous test's
 * disconnected players can still broadcast into the shared space.
 */
export function onceMatching<T = any>(
  socket: ClientSocket,
  event: string,
  predicate: (payload: T) => boolean,
  timeoutMs = 3_000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeoutMs);
    const listener = (payload: T) => {
      if (!predicate(payload)) return;
      clearTimeout(timeout);
      socket.off(event, listener);
      resolve(payload);
    };
    socket.on(event, listener);
  });
}

/** Assert an event (optionally: matching a predicate) does NOT arrive within the window. */
export async function expectSilence(
  socket: ClientSocket,
  event: string,
  windowMs = 300,
  predicate: (payload: any) => boolean = () => true
): Promise<void> {
  let received: unknown;
  const listener = (payload: unknown) => {
    if (received === undefined && predicate(payload)) received = payload ?? "(no payload)";
  };
  socket.on(event, listener);
  await sleep(windowMs);
  socket.off(event, listener);
  if (received !== undefined) {
    throw new Error(`Expected no "${event}" but received: ${JSON.stringify(received)}`);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
