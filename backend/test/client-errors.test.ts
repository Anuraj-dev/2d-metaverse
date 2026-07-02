import type { AddressInfo } from "node:net";
import express from "express";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { createClientErrorsRouter } from "../src/client-errors.js";
import { requestLogger } from "../src/request-logger.js";

interface CapturedLine {
  level: number;
  module?: string;
  message?: string;
  sha?: string;
  requestId?: string;
  [key: string]: unknown;
}

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function startApp(limit = 10) {
  const lines: CapturedLine[] = [];
  const stream = { write: (chunk: string) => void lines.push(JSON.parse(chunk) as CapturedLine) };
  const logger = pino({ base: { service: "backend", sha: "test" } }, stream);
  const app = express();
  app.use(requestLogger(logger));
  app.use("/client-errors", createClientErrorsRouter(logger, { limit, windowMs: 60_000 }));
  const base = await new Promise<string>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      closers.push(() => server.close());
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
  return { base, lines };
}

function post(base: string, body: unknown) {
  return fetch(`${base}/client-errors`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

const validReport = {
  message: "TypeError: door is not a function",
  stack: "TypeError: door is not a function\n  at WorldScene.update",
  sha: "abc1234",
  url: "/",
  userAgent: "vitest",
  context: "WorldScene"
};

describe("client-errors endpoint", () => {
  it("accepts a valid report with 204 and logs it at error level with module client-error", async () => {
    const { base, lines } = await startApp();
    const response = await post(base, validReport);
    expect(response.status).toBe(204);

    const report = lines.find((line) => line.module === "client-error");
    expect(report).toBeDefined();
    expect(report!.level).toBe(50); // error
    expect(report!.message).toBe(validReport.message);
    expect(report!.sha).toBe("abc1234");
    expect(report!.requestId).toBeDefined();
  });

  it("rejects an invalid shape with 400", async () => {
    const { base } = await startApp();
    expect((await post(base, { stack: "no message or sha" })).status).toBe(400);
    expect((await post(base, { message: "", sha: "abc" })).status).toBe(400);
  });

  it("rejects oversize fields with 400", async () => {
    const { base } = await startApp();
    const response = await post(base, { ...validReport, message: "x".repeat(2001) });
    expect(response.status).toBe(400);
  });

  it("rejects bodies over the 16kb cap", async () => {
    const { base } = await startApp();
    const response = await post(base, { ...validReport, stack: "x".repeat(20_000) });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).not.toBe(204);
  });

  it("rate limits with 429 after the per-IP limit", async () => {
    const { base } = await startApp(3);
    for (let index = 0; index < 3; index += 1) {
      expect((await post(base, validReport)).status).toBe(204);
    }
    const limited = await post(base, validReport);
    expect(limited.status).toBe(429);
  });
});
