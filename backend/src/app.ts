import http from "node:http";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { api } from "./api.js";
import { createClientErrorsRouter } from "./client-errors.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { geometryManifestReady } from "./geometry.js";
import { childLogger, logger } from "./logger.js";
import { redis } from "./redis.js";
import { requestLog, requestLogger } from "./request-logger.js";
import { createGameServer } from "./socket.js";

const log = childLogger({ module: "http" });

function isAuthPath(path: string): boolean {
  return path === "/api/v1/signup" || path === "/api/v1/signin";
}

function isMalformedJson(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 400 &&
    "type" in error &&
    error.type === "entity.parse.failed"
  );
}

/**
 * Build the fully wired Express app without binding a port. Kept separate from
 * index.ts so tests can boot the identical app in-process on an ephemeral port.
 */
export function createApp(): express.Express {
  const app = express();
  if (config.trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: false }));
  app.use(requestLogger(logger));
  // Mounted before the app-level JSON parser so its own 16kb body cap applies.
  app.use("/client-errors", createClientErrorsRouter(log));
  app.use(express.json({ limit: "32kb" }));

  app.get("/health/live", (_request, response) => response.json({ ok: true, sha: config.GIT_SHA }));
  app.get("/health/ready", async (_request, response) => {
    // An invalid/stale geometry manifest makes the server unfit to serve — report
    // it before (and independently of) the datastore checks.
    if (!geometryManifestReady()) {
      response.status(503).json({ ok: false, sha: config.GIT_SHA, reason: "geometry-manifest" });
      return;
    }
    try {
      await Promise.all([pool.query("SELECT 1"), redis.ping()]);
      response.json({ ok: true, sha: config.GIT_SHA });
    } catch {
      response.status(503).json({ ok: false, sha: config.GIT_SHA });
    }
  });
  app.use("/api/v1", api);
  app.use((_request, response) => response.status(404).json({ error: "not-found" }));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (isAuthPath(_request.path) && isMalformedJson(error)) {
      response.status(400).json({ error: "validation" });
      return;
    }
    requestLog(response, log).error({ err: error }, "unhandled request error");
    response.status(500).json({ error: isAuthPath(_request.path) ? "server-error" : "internal-error" });
  });

  return app;
}

/** Build the HTTP server and attach the Socket.IO game server, still unbound. */
export function createServer(): { server: http.Server; io: ReturnType<typeof createGameServer> } {
  const server = http.createServer(createApp());
  const io = createGameServer(server);
  return { server, io };
}
