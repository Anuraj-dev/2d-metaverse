/**
 * Media-layer logic: the pure decisions the LiveKit layer makes, split out from
 * the connection plumbing (livekit.ts). These functions decide *which* room name
 * to request, *what* to do with a subscribed track, and *how loud* each remote
 * should be — none of which need a real `livekit-client` connection to verify.
 *
 * The transport (Room construction, connect/disconnect, event wiring) stays in
 * livekit.ts; it imports these to make its decisions, so the decisions are unit
 * tested here against plain fixtures.
 */
import { proximityVolume } from "../game/proximity";

/** Distance (px) beyond which a world-audio participant is fully silent. */
export const AUDIO_CUTOFF = 200;

/* --------------------------- Room name builders --------------------------- */
/** World (proximity-audio) room for a space. */
export function worldRoomName(spaceId: string): string {
  return `world:${spaceId}`;
}
/** Private meeting room (cam+mic). */
export function roomRoomName(roomId: string): string {
  return `room:${roomId}`;
}
/** Auditorium stage room for a space. */
export function stageRoomName(spaceId: string): string {
  return `stage:${spaceId}`;
}

/* ------------------------------ Track routing ----------------------------- */
/**
 * What a room does with a subscribed/unsubscribed track. Two room modes exist:
 *  - "world-audio" (proximity room): mic-only. Audio attaches *silent* — volume 0
 *    until the first positions tick prices it by distance. Video is ignored.
 *  - "room-av" (private room / stage): video is surfaced to the UI for avatar
 *    bubbles; audio attaches as a hidden element at full volume.
 * The livekit.ts transport handlers consume these decisions verbatim.
 */
export type RoomMode = "world-audio" | "room-av";
export type SubscribeAction =
  | "surface-video"
  | "attach-audio"
  | "attach-audio-silent"
  | "ignore";
export type UnsubscribeAction = "drop-video" | "detach-audio";

export function subscribeAction(kind: "audio" | "video", mode: RoomMode): SubscribeAction {
  if (kind === "video") return mode === "room-av" ? "surface-video" : "ignore";
  return mode === "world-audio" ? "attach-audio-silent" : "attach-audio";
}

export function unsubscribeAction(
  kind: "audio" | "video",
  mode: RoomMode
): UnsubscribeAction {
  if (mode === "room-av" && kind === "video") return "drop-video";
  return "detach-audio";
}

/* ---------------------------- Proximity volumes --------------------------- */
export interface MediaPos {
  id: string;
  self?: boolean;
  x: number;
  y: number;
}

/**
 * Compute each subscribed remote's volume from the latest positions.
 *  - a remote with no known position is silenced (0)
 *  - when the local player's own position is unknown, returns null so the caller
 *    leaves existing volumes untouched (matches the scene's original guard)
 */
export function computeVolumes(
  players: MediaPos[],
  selfId: string,
  subscribedIds: Iterable<string>,
  cutoff: number = AUDIO_CUTOFF
): Map<string, number> | null {
  const me = players.find((pl) => pl.id === selfId || pl.self);
  if (!me) return null;
  const out = new Map<string, number>();
  for (const id of subscribedIds) {
    const other = players.find((pl) => pl.id === id);
    if (!other) {
      out.set(id, 0);
      continue;
    }
    const d = Math.hypot(other.x - me.x, other.y - me.y);
    out.set(id, proximityVolume(d, cutoff));
  }
  return out;
}
