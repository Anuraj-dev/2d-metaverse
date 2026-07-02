import { Router, json } from "express";
import rateLimit from "express-rate-limit";
import type { Logger } from "pino";
import { RATE_LIMITS, clientErrorSchema } from "@metaverse/shared";
import { requestLog } from "./request-logger.js";

/**
 * Frontend error beacon sink. Unauthenticated by design — client crashes can
 * happen before login — so it is defended by a strict per-IP rate limit and a
 * small body cap instead. Reports are logged (module: "client-error") and
 * deliberately not persisted anywhere else. The payload schema lives in
 * @metaverse/shared.
 */
export interface ClientErrorsOptions {
  windowMs?: number;
  limit?: number;
}

export function createClientErrorsRouter(base: Logger, options: ClientErrorsOptions = {}): Router {
  const router = Router();
  const limiter = rateLimit({
    windowMs: options.windowMs ?? RATE_LIMITS.clientErrorWindowMs,
    limit: options.limit ?? RATE_LIMITS.clientErrorLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false
  });
  // Route-scoped body parser: mount this router BEFORE any app-level
  // express.json() so the 16kb cap actually applies to this endpoint.
  router.post("/", limiter, json({ limit: "16kb" }), (request, response) => {
    const parsed = clientErrorSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid-client-error" });
      return;
    }
    requestLog(response, base).error({ module: "client-error", ...parsed.data }, "client error reported");
    response.status(204).end();
  });
  return router;
}
