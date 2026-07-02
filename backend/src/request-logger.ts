import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Logger } from "pino";

/**
 * Per-request correlation: generates a requestId, echoes it as X-Request-Id,
 * binds a child logger on res.locals, and logs one line at completion.
 * Health checks are demoted to debug so they never drown real traffic.
 */
export function requestLogger(base: Logger): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const requestId = randomUUID();
    const log = base.child({ requestId });
    response.locals.log = log;
    response.locals.requestId = requestId;
    response.setHeader("X-Request-Id", requestId);
    const startedAt = process.hrtime.bigint();
    response.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const path = (request.originalUrl || request.url).split("?")[0] ?? request.url;
      const fields = {
        method: request.method,
        path,
        status: response.statusCode,
        durationMs: Math.round(durationMs * 100) / 100
      };
      if (response.statusCode >= 500) log.error(fields, "request completed");
      else if (path.startsWith("/health/")) log.debug(fields, "request completed");
      else log.info(fields, "request completed");
    });
    next();
  };
}

/** Typed accessor for the request-bound child logger set by requestLogger. */
export function requestLog(response: Response, fallback: Logger): Logger {
  const log = response.locals.log as Logger | undefined;
  return log ?? fallback;
}
