/**
 * Pure, side-effect-free environment parsing. config.ts wraps this into the
 * process-wide singleton (and exits on failure); tests import parseConfig
 * directly and feed it env fixtures without touching process.env.
 */
import { z } from "zod";

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
  ROOM_1_KEY: z.string().min(1).optional(),
  ROOM_2_KEY: z.string().min(1).optional(),
  ROOM_3_KEY: z.string().min(1).optional(),
  ROOM_4_KEY: z.string().min(1).optional(),
  ROOM_5_KEY: z.string().min(1).optional(),
  ROOM_6_KEY: z.string().min(1).optional(),
  STAGE_KEY: z.string().min(1).optional(),
  MAP_JSON_URL: z.string().default("/assets/maps/space.json"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  GIT_SHA: z.string().default("dev")
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
    !data.ROOM_1_KEY || data.ROOM_1_KEY === "1234" ||
    !data.ROOM_2_KEY || data.ROOM_2_KEY === "4321" ||
    !data.ROOM_3_KEY || data.ROOM_3_KEY === "3333" ||
    !data.ROOM_4_KEY || data.ROOM_4_KEY === "4444" ||
    !data.ROOM_5_KEY || data.ROOM_5_KEY === "5555" ||
    !data.ROOM_6_KEY || data.ROOM_6_KEY === "6666" ||
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
