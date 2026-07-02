import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../src/parse-config.js";

/** A development env that parses successfully. */
const devEnv: Record<string, string> = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://metaverse:metaverse@localhost:5432/metaverse",
  REDIS_URL: "redis://localhost:6379",
  JWT_SECRET: "local-development-jwt-secret-change-me-now",
  LIVEKIT_URL: "ws://localhost:7880",
  LIVEKIT_API_KEY: "devkey",
  LIVEKIT_API_SECRET: "local-development-livekit-secret-change-me"
};

/** A production env with every secret replaced — must be accepted as-is. */
const productionEnv: Record<string, string> = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://app:s3cure-db-password@db.internal:5432/metaverse",
  REDIS_URL: "redis://redis.internal:6379",
  JWT_SECRET: "a-genuinely-random-production-secret-0123456789",
  LIVEKIT_URL: "wss://livekit.example.com",
  LIVEKIT_API_KEY: "prod-livekit-key",
  LIVEKIT_API_SECRET: "prod-livekit-secret-with-plenty-of-entropy",
  ROOM_1_KEY: "r1-prod", ROOM_2_KEY: "r2-prod", ROOM_3_KEY: "r3-prod",
  ROOM_4_KEY: "r4-prod", ROOM_5_KEY: "r5-prod", ROOM_6_KEY: "r6-prod",
  STAGE_KEY: "prod-stage-presenter-key"
};

describe("parseConfig validation", () => {
  it("parses a development env and applies defaults", () => {
    const config = parseConfig(devEnv);
    expect(config.NODE_ENV).toBe("development");
    expect(config.PORT).toBe(3001);
    expect(config.JWT_TTL).toBe("7d");
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.GIT_SHA).toBe("dev");
  });

  it("rejects a missing DATABASE_URL", () => {
    const { DATABASE_URL: _omitted, ...rest } = devEnv;
    expect(() => parseConfig(rest)).toThrowError(ConfigError);
  });

  it("rejects a JWT secret shorter than 32 characters", () => {
    expect(() => parseConfig({ ...devEnv, JWT_SECRET: "short" })).toThrowError(ConfigError);
  });

  it("rejects an out-of-range PORT and an unknown LOG_LEVEL", () => {
    expect(() => parseConfig({ ...devEnv, PORT: "70000" })).toThrowError(ConfigError);
    expect(() => parseConfig({ ...devEnv, LOG_LEVEL: "verbose" })).toThrowError(ConfigError);
  });
});

describe("parseConfig derived fields", () => {
  it("derives liveKitApiUrl from LIVEKIT_URL by swapping ws for http", () => {
    expect(parseConfig(devEnv).liveKitApiUrl).toBe("http://localhost:7880");
    expect(parseConfig({ ...devEnv, LIVEKIT_URL: "wss://livekit.example.com" }).liveKitApiUrl)
      .toBe("https://livekit.example.com");
  });

  it("prefers an explicit LIVEKIT_API_URL", () => {
    expect(parseConfig({ ...devEnv, LIVEKIT_API_URL: "http://livekit:7880" }).liveKitApiUrl)
      .toBe("http://livekit:7880");
  });

  it("splits and trims CORS_ORIGINS", () => {
    const config = parseConfig({ ...devEnv, CORS_ORIGINS: "https://a.example , https://b.example,," });
    expect(config.corsOrigins).toEqual(["https://a.example", "https://b.example"]);
  });

  it("parses TRUST_PROXY into a boolean", () => {
    expect(parseConfig(devEnv).trustProxy).toBe(false);
    expect(parseConfig({ ...devEnv, TRUST_PROXY: "true" }).trustProxy).toBe(true);
  });
});

describe("production refusal of development defaults", () => {
  it("accepts a fully replaced production env", () => {
    const config = parseConfig(productionEnv);
    expect(config.NODE_ENV).toBe("production");
  });

  const refusals: Array<[string, Record<string, string | undefined>]> = [
    ["dev-default JWT secret", { JWT_SECRET: "local-development-jwt-secret-change-me-now" }],
    ["placeholder replace- JWT secret", { JWT_SECRET: "replace-with-at-least-32-random-characters" }],
    ["dev LiveKit API key", { LIVEKIT_API_KEY: "devkey" }],
    ["dev LiveKit API secret", { LIVEKIT_API_SECRET: "local-development-livekit-secret-change-me" }],
    ["dev ROOM_1_KEY", { ROOM_1_KEY: "1234" }],
    ["missing ROOM_1_KEY", { ROOM_1_KEY: undefined }],
    ["dev ROOM_2_KEY", { ROOM_2_KEY: "4321" }],
    ["missing ROOM_2_KEY", { ROOM_2_KEY: undefined }],
    ["dev ROOM_3_KEY", { ROOM_3_KEY: "3333" }],
    ["missing ROOM_3_KEY", { ROOM_3_KEY: undefined }],
    ["dev ROOM_4_KEY", { ROOM_4_KEY: "4444" }],
    ["missing ROOM_4_KEY", { ROOM_4_KEY: undefined }],
    ["dev ROOM_5_KEY", { ROOM_5_KEY: "5555" }],
    ["missing ROOM_5_KEY", { ROOM_5_KEY: undefined }],
    ["dev ROOM_6_KEY", { ROOM_6_KEY: "6666" }],
    ["missing ROOM_6_KEY", { ROOM_6_KEY: undefined }],
    ["dev STAGE_KEY", { STAGE_KEY: "stage-presenter-123" }],
    ["missing STAGE_KEY", { STAGE_KEY: undefined }],
    ["dev DATABASE_URL credentials", { DATABASE_URL: "postgres://metaverse:metaverse@db:5432/metaverse" }]
  ];

  it.each(refusals)("refuses production with %s", (_label, override) => {
    expect(() => parseConfig({ ...productionEnv, ...override }))
      .toThrowError("refusing to start production with development credentials");
  });

  it("allows every one of those defaults outside production", () => {
    expect(() => parseConfig(devEnv)).not.toThrow();
  });
});
