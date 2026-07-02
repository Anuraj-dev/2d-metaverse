import type { AddressInfo } from "node:net";
import express from "express";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { requestLogger } from "../src/request-logger.js";

interface CapturedLine {
  level: number;
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  msg?: string;
  [key: string]: unknown;
}

function captureLogger(level = "info") {
  const lines: CapturedLine[] = [];
  const stream = { write: (chunk: string) => void lines.push(JSON.parse(chunk) as CapturedLine) };
  return { logger: pino({ level, base: { service: "backend", sha: "test" } }, stream), lines };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for log line");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

function listen(app: express.Express): Promise<string> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      closers.push(() => server.close());
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

describe("requestLogger middleware", () => {
  it("logs one JSON line per request with correlation fields and echoes X-Request-Id", async () => {
    const { logger, lines } = captureLogger();
    const app = express();
    app.use(requestLogger(logger));
    app.get("/hello", (_request, response) => void response.json({ ok: true }));

    const base = await listen(app);
    const response = await fetch(`${base}/hello?x=1`);
    expect(response.status).toBe(200);
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);

    await waitFor(() => lines.length === 1);
    const line = lines[0]!;
    expect(line.level).toBe(30); // info
    expect(line.requestId).toBe(requestId);
    expect(line.method).toBe("GET");
    expect(line.path).toBe("/hello");
    expect(line.status).toBe(200);
    expect(typeof line.durationMs).toBe("number");
    expect(line.service).toBe("backend");
    expect(line.sha).toBe("test");
  });

  it("logs 5xx responses at error level", async () => {
    const { logger, lines } = captureLogger();
    const app = express();
    app.use(requestLogger(logger));
    app.get("/boom", (_request, response) => void response.status(500).json({ error: "internal-error" }));

    const base = await listen(app);
    await fetch(`${base}/boom`);
    await waitFor(() => lines.length === 1);
    expect(lines[0]!.level).toBe(50); // error
    expect(lines[0]!.status).toBe(500);
  });

  it("demotes health-check requests to debug", async () => {
    const { logger, lines } = captureLogger("debug");
    const app = express();
    app.use(requestLogger(logger));
    app.get("/health/live", (_request, response) => void response.json({ ok: true }));

    const base = await listen(app);
    await fetch(`${base}/health/live`);
    await waitFor(() => lines.length === 1);
    expect(lines[0]!.level).toBe(20); // debug
    expect(lines[0]!.path).toBe("/health/live");
  });
});
