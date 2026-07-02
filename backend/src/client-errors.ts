import { Router, json } from "express";
import rateLimit from "express-rate-limit";
import type { Logger } from "pino";
import { z } from "zod";
import { requestLog } from "./request-logger.js";

/**
 * Frontend error beacon sink. Unauthenticated by design — client crashes can
 * happen before login — so it is defended by a strict per-IP rate limit and a
 * small body cap instead. Reports are logged (module: "client-error") and
 * deliberately not persisted anywhere else.
 */
const clientErrorSchema = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  sha: z.string().min(1).max(64),
  url: z.string().max(500).optional(),
  userAgent: z.string().max(300).optional(),
  context: z.string().max(200).optional()
});

export interface ClientErrorsOptions {
  windowMs?: number;
  limit?: number;
}

export function createClientErrorsRouter(base: Logger, options: ClientErrorsOptions = {}): Router {
  const router = Router();
  const limiter = rateLimit({
    windowMs: options.windowMs ?? 60_000,
    limit: options.limit ?? 10,
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
