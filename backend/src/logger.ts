/**
 * Root structured logger. JSON to stdout — Docker collects and rotates it.
 *
 * This module intentionally reads LOG_LEVEL straight from process.env instead
 * of importing config.ts: config validation must be able to log fatal errors
 * through this logger, so the dependency points config -> logger only.
 * config.ts still zod-validates LOG_LEVEL so a typo fails fast at boot.
 */
import { destination, pino, type Logger } from "pino";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const requested = process.env.LOG_LEVEL ?? "info";
const level: LogLevel = (LOG_LEVELS as readonly string[]).includes(requested)
  ? (requested as LogLevel)
  : "info";

// Sync destination: never lose lines on process.exit (config failures,
// one-shot migrate/seed scripts). Throughput here is far below sync limits.
export const logger: Logger = pino(
  {
    level,
    base: { service: "backend", sha: process.env.GIT_SHA ?? "dev" }
  },
  destination({ sync: true })
);

/** Create a child logger carrying extra bindings (module, requestId, socketId, …). */
export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
