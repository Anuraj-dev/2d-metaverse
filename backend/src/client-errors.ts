import { Router, json } from "express";
import rateLimit from "express-rate-limit";
import type { Logger } from "pino";
import { RATE_LIMITS, clientErrorSchema, operationalReportSchema } from "@metaverse/shared";
import { requestLog } from "./request-logger.js";

/**
 * Frontend error beacon sink. Unauthenticated by design — client crashes can
 * happen before login — so it is defended by a strict per-IP rate limit and a
 * small body cap instead. Reports are logged (module: "client-error") and
 * deliberately not persisted anywhere else. The payload schema lives in
 * @metaverse/shared.
 *
 * `POST /` receives UNCAUGHT crashes (free-text message/stack). `POST /operational`
 * receives CAUGHT operational failures (PRD 25.8) as a bounded `{ category, reason }`
 * pair — no free text — and shares this router's per-IP limiter and body cap.
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
  // Handled operational failures (PRD 25.8): bounded category/reason, logged at
  // warn (they are caught + recovered, not crashes) under the same module label.
  router.post("/operational", limiter, json({ limit: "16kb" }), (request, response) => {
    const parsed = operationalReportSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid-client-error" });
      return;
    }
    requestLog(response, base).warn(
      { module: "client-error", kind: "operational", ...parsed.data },
      "handled operational error reported"
    );
    response.status(204).end();
  });
  return router;
}
