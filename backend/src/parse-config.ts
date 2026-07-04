/**
 * Pure, side-effect-free environment parsing. config.ts wraps this into the
 * process-wide singleton (and exits on failure); tests import parseConfig
 * directly and feed it env fixtures without touching process.env.
 */
import { z } from "zod";
import { KNOCK_TIMEOUT_MS } from "@metaverse/shared";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Use "debug" for chatty local development; production stays at "info".
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_TTL: z.string().default("7d"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  LIVEKIT_URL: z.string().min(1),
  LIVEKIT_API_URL: z.string().min(1).optional(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  // Private rooms are no longer password-gated (PRD 14): entry is admin + knock.
  // Only the stage presenter key remains a shared secret.
  STAGE_KEY: z.string().min(1).optional(),
  MAP_JSON_URL: z.string().default("/assets/maps/campus.json"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  GIT_SHA: z.string().default("dev"),
  // Socket timing knobs. Overridden only by tests (to exercise the join-timeout
  // and reconnect-grace paths quickly); validated here so a typo'd override can
  // never boot a server whose grace window is 0, negative, NaN, or infinite.
  JOIN_TIMEOUT_MS: z.coerce.number().int().positive().finite().default(10_000),
  LEAVE_GRACE_MS: z.coerce.number().int().positive().finite().default(4_000),
  // Meeting-start countdown (PRD 10). Default mirrors shared MEETING_COUNTDOWN_MS;
  // integration tests shrink it to exercise the countdown → started path quickly.
  MEETING_COUNTDOWN_MS: z.coerce.number().int().positive().finite().default(3_000),
  // Knock auto-expiry (PRD 14). Default mirrors shared KNOCK_TIMEOUT_MS;
  // integration tests shrink it to exercise the knock → timeout path quickly.
  KNOCK_TIMEOUT_MS: z.coerce.number().int().positive().finite().default(KNOCK_TIMEOUT_MS)
});

type ParsedEnv = z.infer<typeof schema>;
export type AppConfig = ParsedEnv & {
  liveKitApiUrl: string;
  corsOrigins: string[];
  trustProxy: boolean;
};

/**
 * Raised instead of exiting the process, so tests can assert on rejection
 * without tearing down the test runner. config.ts converts it into a fatal
 * log + process.exit at boot.
 */
export class ConfigError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message);
    this.name = "ConfigError";
  }
}

/** True when a parsed production env still carries any shipped development default. */
function usesDevelopmentSecret(data: ParsedEnv): boolean {
  return (
    data.JWT_SECRET === "local-development-jwt-secret-change-me-now" ||
    data.JWT_SECRET.startsWith("replace-") ||
    data.LIVEKIT_API_KEY === "devkey" ||
    data.LIVEKIT_API_SECRET === "local-development-livekit-secret-change-me" ||
    !data.STAGE_KEY || data.STAGE_KEY === "stage-presenter-123" ||
    data.DATABASE_URL.includes("metaverse:metaverse@")
  );
}

/**
 * Validate env, refuse production configured with dev defaults, and derive
 * computed fields. Throws ConfigError on any failure.
 */
export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError("invalid environment configuration", z.treeifyError(parsed.error));
  }
  if (parsed.data.NODE_ENV === "production" && usesDevelopmentSecret(parsed.data)) {
    throw new ConfigError("refusing to start production with development credentials");
  }
  return {
    ...parsed.data,
    liveKitApiUrl: parsed.data.LIVEKIT_API_URL ?? parsed.data.LIVEKIT_URL.replace(/^ws/, "http"),
    corsOrigins: parsed.data.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
    trustProxy: parsed.data.TRUST_PROXY === "true"
  };
}
