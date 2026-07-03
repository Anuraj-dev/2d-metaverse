import { Router } from "express";
import rateLimit from "express-rate-limit";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { z } from "zod";
import { RATE_LIMITS, credentialsSchema, liveKitSchema } from "@metaverse/shared";
import { issueToken, requireAuth, type AuthenticatedRequest } from "./auth.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { hashSecret, verifySecret } from "./password.js";
import { getRoom, getSpace, spaceExists } from "./repository.js";
import { redis } from "./redis.js";

// Request schemas live in @metaverse/shared (single source of truth for wire shapes).
export const api = Router();
const authLimiter = rateLimit({
  windowMs: RATE_LIMITS.authWindowMs,
  limit: RATE_LIMITS.authLimit,
  standardHeaders: "draft-8",
  legacyHeaders: false
});

api.post("/signup", authLimiter, async (request, response) => {
  const parsed = credentialsSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "invalid-credentials", details: z.flattenError(parsed.error).fieldErrors });
    return;
  }
  const passwordHash = await hashSecret(parsed.data.password);
  try {
    await pool.query("INSERT INTO users (username, password_hash) VALUES ($1, $2)", [parsed.data.username, passwordHash]);
    response.status(200).json({ ok: true });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      response.status(400).json({ error: "username-taken" });
      return;
    }
    throw error;
  }
});

api.post("/signin", authLimiter, async (request, response) => {
  const parsed = credentialsSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(401).json({ error: "invalid-credentials" });
    return;
  }
  const result = await pool.query<{ id: string; username: string; password_hash: string }>(
    "SELECT id, username, password_hash FROM users WHERE username = $1",
    [parsed.data.username]
  );
  const user = result.rows[0];
  if (!user || !(await verifySecret(parsed.data.password, user.password_hash))) {
    response.status(401).json({ error: "invalid-credentials" });
    return;
  }
  response.json({ token: issueToken({ id: user.id, username: user.username }) });
});

api.get("/space/:id", requireAuth, async (request, response) => {
  const id = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
  const space = await getSpace(id ?? "");
  if (!space) {
    response.status(404).json({ error: "space-not-found" });
    return;
  }
  response.json(space);
});

api.post("/livekit/token", requireAuth, async (request, response) => {
  const parsed = liveKitSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "invalid-room-name" });
    return;
  }
  const user = (request as AuthenticatedRequest).user;
  const roomName = parsed.data.roomName;
  let canPublish = true;
  let canPublishVideo = false;
  const lkRoom = roomName;  // LiveKit room name (may differ from request roomName)

  if (roomName.startsWith("world:")) {
    const spaceId = roomName.slice("world:".length);
    if (!spaceId || !(await spaceExists(spaceId))) {
      response.status(404).json({ error: "space-not-found" });
      return;
    }
  } else if (roomName.startsWith("room:")) {
    const roomId = roomName.slice("room:".length);
    const room = await getRoom(roomId);
    // A private room's media token requires BOTH the seat lock AND the same
    // room-access grant the key flow establishes (`room-enter`). The seat lock
    // alone is not proof of access: the seat-claim Lua never records access, and
    // a seat lock can outlive its access grant (access is revoked on room-leave/
    // disconnect while the seat's TTL persists). Gating on access too keeps the
    // token consistent with seat-sit and room-chat — a client that never
    // presented the key can never obtain the room's audio/video.
    const occupiedSeat = await redis.get(`player-seat:${user.id}`);
    const hasAccess = await redis.exists(`room-access:${user.id}:${roomId}`);
    if (!room || !hasAccess || !occupiedSeat?.startsWith(`seat:${roomId}:`)) {
      response.status(403).json({ error: "seat-required" });
      return;
    }
    canPublishVideo = true;
  } else if (roomName.startsWith("stage:")) {
    const spaceId = roomName.slice("stage:".length);
    if (!spaceId || !(await spaceExists(spaceId))) {
      response.status(404).json({ error: "space-not-found" });
      return;
    }
    const pKey = parsed.data.presenterKey;
    if (pKey !== undefined) {
      if (!config.STAGE_KEY || pKey !== config.STAGE_KEY) {
        response.status(403).json({ error: "bad-presenter-key" });
        return;
      }
      canPublishVideo = true;  // presenter: cam + screen + mic
    } else {
      canPublish = false;  // audience: subscribe-only
    }
  } else {
    response.status(400).json({ error: "invalid-room-name" });
    return;
  }

  const token = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
    identity: user.id,
    name: user.username,
    ttl: "15m"
  });
  token.addGrant({
    room: lkRoom,
    roomJoin: true,
    canPublish,
    canSubscribe: true,
    canPublishData: canPublish,
    ...(canPublish && !canPublishVideo ? { canPublishSources: [TrackSource.MICROPHONE] } : {})
  });
  response.json({ livekitToken: await token.toJwt(), url: config.LIVEKIT_URL });
});
