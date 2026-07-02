/**
 * REST wire contract: request-body schemas the backend `safeParse`s, plus the
 * response shapes both sides rely on. Same source of truth as the socket events.
 */
import { z } from "zod";
import { dirSchema } from "./socket.js";
import { LIMITS, USERNAME_PATTERN } from "./constants.js";

/* ------------------------------- requests --------------------------------- */

/** `POST /api/v1/signup` and `/signin` body. */
export const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(LIMITS.usernameMin)
    .max(LIMITS.usernameMax)
    .regex(USERNAME_PATTERN),
  password: z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax),
});
export type Credentials = z.infer<typeof credentialsSchema>;

/** `POST /api/v1/livekit/token` body. */
export const liveKitSchema = z.object({
  roomName: z.string().min(1).max(LIMITS.roomNameMax),
  presenterKey: z.string().max(LIMITS.presenterKeyMax).optional(),
});
export type LiveKitTokenRequest = z.infer<typeof liveKitSchema>;

/** `POST /client-errors` body (frontend error beacon). */
export const clientErrorSchema = z.object({
  message: z.string().min(1).max(LIMITS.clientErrorMessageMax),
  stack: z.string().max(LIMITS.clientErrorStackMax).optional(),
  sha: z.string().min(1).max(LIMITS.clientErrorShaMax),
  url: z.string().max(LIMITS.clientErrorUrlMax).optional(),
  userAgent: z.string().max(LIMITS.clientErrorUserAgentMax).optional(),
  context: z.string().max(LIMITS.clientErrorContextMax).optional(),
});
export type ClientErrorReport = z.infer<typeof clientErrorSchema>;

/* ------------------------------- responses -------------------------------- */

/** A private room within a space, as returned by `GET /api/v1/space/:id`. */
export const roomInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  doorZone: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  seats: z.array(
    z.object({
      id: z.number(),
      x: z.number(),
      y: z.number(),
      facing: dirSchema,
    }),
  ),
});
export type RoomInfo = z.infer<typeof roomInfoSchema>;

/** `GET /api/v1/space/:id` response. */
export const spaceInfoSchema = z.object({
  mapJsonUrl: z.string(),
  rooms: z.array(roomInfoSchema),
});
export type SpaceInfo = z.infer<typeof spaceInfoSchema>;

/** `POST /api/v1/signin` success response. */
export const authTokenResponseSchema = z.object({ token: z.string() });
export type AuthTokenResponse = z.infer<typeof authTokenResponseSchema>;

/** `POST /api/v1/livekit/token` success response. */
export const liveKitTokenResponseSchema = z.object({
  livekitToken: z.string(),
  url: z.string(),
});
export type LiveKitTokenResponse = z.infer<typeof liveKitTokenResponseSchema>;
