import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
  MAP_JSON_URL: z.string().default("/assets/maps/space.json"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false")
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration", z.treeifyError(parsed.error));
  process.exit(1);
}

if (parsed.data.NODE_ENV === "production") {
  const usesDevelopmentSecret =
    parsed.data.JWT_SECRET === "local-development-jwt-secret-change-me-now" ||
    parsed.data.JWT_SECRET.startsWith("replace-") ||
    parsed.data.LIVEKIT_API_KEY === "devkey" ||
    parsed.data.LIVEKIT_API_SECRET === "local-development-livekit-secret-change-me" ||
    !parsed.data.ROOM_1_KEY || parsed.data.ROOM_1_KEY === "1234" ||
    !parsed.data.ROOM_2_KEY || parsed.data.ROOM_2_KEY === "4321" ||
    !parsed.data.ROOM_3_KEY || parsed.data.ROOM_3_KEY === "3333" ||
    parsed.data.DATABASE_URL.includes("metaverse:metaverse@");
  if (usesDevelopmentSecret) {
    console.error("Refusing to start production with development credentials");
    process.exit(1);
  }
}

export const config = {
  ...parsed.data,
  liveKitApiUrl: parsed.data.LIVEKIT_API_URL ?? parsed.data.LIVEKIT_URL.replace(/^ws/, "http"),
  corsOrigins: parsed.data.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  trustProxy: parsed.data.TRUST_PROXY === "true"
};
