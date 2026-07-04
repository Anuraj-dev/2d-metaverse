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
import { OUTDOOR_ZONE, zoneVolume } from "../game/audioZones";

/** Distance (px) beyond which a world-audio participant is fully silent. */
export const AUDIO_CUTOFF = 200;

/**
 * Fixed listening volume for the stage broadcast (PRD 17). NOT distance-scaled:
 * every non-private-room client hears an on-stage performer at this level. Tuned
 * below 1.0 so a nearby proximity conversation still reads over the broadcast.
 */
export const STAGE_VOLUME = 0.75;

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
 * What a room does with a subscribed/unsubscribed track. Three room modes exist:
 *  - "world-audio" (proximity room): mic-only. Audio attaches *silent* — volume 0
 *    until the first positions tick prices it by distance. Video is ignored.
 *  - "room-av" (private room): video is surfaced to the UI for avatar bubbles;
 *    audio attaches as a hidden element at full volume.
 *  - "stage-audience" (broadcast room, PRD 17): video is surfaced like room-av,
 *    but audio attaches at the FIXED `STAGE_VOLUME` (not distance-scaled) — the
 *    performer is heard server-wide at one comfortable level.
 * The livekit.ts transport handlers consume these decisions verbatim.
 */
export type RoomMode = "world-audio" | "room-av" | "stage-audience";
export type SubscribeAction =
  | "surface-video"
  | "attach-audio"
  | "attach-audio-fixed"
  | "attach-audio-silent"
  | "ignore";
export type UnsubscribeAction = "drop-video" | "detach-audio";

export function subscribeAction(kind: "audio" | "video", mode: RoomMode): SubscribeAction {
  if (kind === "video") return mode === "world-audio" ? "ignore" : "surface-video";
  if (mode === "world-audio") return "attach-audio-silent";
  if (mode === "stage-audience") return "attach-audio-fixed";
  return "attach-audio";
}

export function unsubscribeAction(
  kind: "audio" | "video",
  mode: RoomMode
): UnsubscribeAction {
  if (mode !== "world-audio" && kind === "video") return "drop-video";
  return "detach-audio";
}

/* ---------------------------- Proximity volumes --------------------------- */
export interface MediaPos {
  id: string;
  self?: boolean;
  x: number;
  y: number;
  /**
   * Audio zone the player is in (room id, or `OUTDOOR_ZONE`). Computed by the
   * scene from the map's room rectangles and threaded through the positions
   * payload — no wire-format change, no extra network traffic. Absent zones
   * default to outdoor, so callers without zone data (older tests / non-zoned
   * maps) keep the pre-PRD pure-distance behaviour.
   */
  zone?: string;
}

/**
 * Compute each subscribed remote's volume from the latest positions, gated by
 * zone: a remote in a different audio zone than the local player is silent (no
 * voice through walls); same-zone remotes keep the existing distance falloff.
 *  - a remote with no known position is silenced (0)
 *  - a remote in `mutedIds` is forced silent regardless of distance/zone. This is
 *    the stage dedupe (PRD 17): a performer whose voice a listener is already
 *    getting server-wide off the stage room has their *proximity* track muted, so
 *    a nearby listener never hears a doubled signal.
 *  - when the local player's own position is unknown, returns null so the caller
 *    leaves existing volumes untouched (matches the scene's original guard)
 */
export function computeVolumes(
  players: MediaPos[],
  selfId: string,
  subscribedIds: Iterable<string>,
  cutoff: number = AUDIO_CUTOFF,
  mutedIds?: Iterable<string>
): Map<string, number> | null {
  const me = players.find((pl) => pl.id === selfId || pl.self);
  if (!me) return null;
  const myZone = me.zone ?? OUTDOOR_ZONE;
  const muted = new Set(mutedIds ?? []);
  const out = new Map<string, number>();
  for (const id of subscribedIds) {
    if (muted.has(id)) {
      out.set(id, 0);
      continue;
    }
    const other = players.find((pl) => pl.id === id);
    if (!other) {
      out.set(id, 0);
      continue;
    }
    const d = Math.hypot(other.x - me.x, other.y - me.y);
    out.set(id, zoneVolume(myZone, other.zone ?? OUTDOOR_ZONE, d, cutoff));
  }
  return out;
}
