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
  const zoned = computeZonedVolumes(players, selfId, subscribedIds, cutoff, mutedIds);
  if (!zoned) return null;
  const out = new Map<string, number>();
  for (const [id, z] of zoned) out.set(id, z.volume);
  return out;
}

/**
 * A remote's target world-audio volume plus the zone-transition signal the
 * ramp layer (`rampVolume`) needs (PRD 21).
 */
export interface ZonedVolume {
  /** The zone-aware target volume — identical to what `computeVolumes` returns. */
  volume: number;
  /**
   * `${myZone}|${theirZone}` — identifies the zone pairing `volume` was
   * computed under. Comparing this tick-to-tick is how the ramp layer tells
   * "same-zone distance changed" (glide) from "the zone gate itself moved"
   * (snap): an unchanged key means any volume delta is same-zone falloff;
   * a changed key means a room/outdoor boundary was crossed since the last
   * tick, and the privacy invariant requires an instant cut, never a ~500ms
   * glide (see decisions.md — zone/door cuts stay instant).
   */
  zoneKey: string;
  /**
   * True when `volume` was NOT decided by the zone/distance model — the
   * stage-performer proximity dedupe, or a subscribed remote with no known
   * position yet. These are state cutovers, not spatial changes, and must
   * always apply instantly regardless of `zoneKey`.
   */
  instant: boolean;
}

/**
 * `computeVolumes`, but also reporting the zone-transition signal each
 * remote's volume was computed under. `computeVolumes` is a thin wrapper over
 * this — the two can never drift apart because there is only one computation.
 */
export function computeZonedVolumes(
  players: MediaPos[],
  selfId: string,
  subscribedIds: Iterable<string>,
  cutoff: number = AUDIO_CUTOFF,
  mutedIds?: Iterable<string>
): Map<string, ZonedVolume> | null {
  const me = players.find((pl) => pl.id === selfId || pl.self);
  if (!me) return null;
  const myZone = me.zone ?? OUTDOOR_ZONE;
  const muted = new Set(mutedIds ?? []);
  const out = new Map<string, ZonedVolume>();
  for (const id of subscribedIds) {
    if (muted.has(id)) {
      out.set(id, { volume: 0, zoneKey: `${myZone}|${id}`, instant: true });
      continue;
    }
    const other = players.find((pl) => pl.id === id);
    if (!other) {
      out.set(id, { volume: 0, zoneKey: `${myZone}|${id}`, instant: true });
      continue;
    }
    const theirZone = other.zone ?? OUTDOOR_ZONE;
    const d = Math.hypot(other.x - me.x, other.y - me.y);
    out.set(id, {
      volume: zoneVolume(myZone, theirZone, d, cutoff),
      zoneKey: `${myZone}|${theirZone}`,
      instant: false,
    });
  }
  return out;
}

/* ------------------------------ Volume ramp -------------------------------- */
/**
 * Time constant (ms) for the same-zone proximity volume ramp (PRD 21): the
 * applied volume glides toward its target with an exponential decay of this
 * time constant, so a conversation doesn't pump up/down in audible steps as
 * either party walks. Zone/door cuts bypass the ramp entirely (`rampVolume`) —
 * this only smooths in-zone distance-driven changes. One tunable knob, per
 * the PRD's "starting point" framing for the 500ms figure.
 */
export const VOICE_RAMP_MS = 500;

/** Per-remote ramp state the transport carries across positions ticks. */
export interface VolumeRampState {
  /** The last applied (post-ramp) volume, 0..1 — what actually reaches the
   * `<audio>` element, as opposed to `ZonedVolume.volume`, the raw target. */
  applied: number;
  /** The `zoneKey` of the tick that produced `applied` (see `ZonedVolume`). */
  zoneKey: string;
}

/**
 * Advance one remote's applied world-audio volume by one frame toward its
 * target — same family as `soundMixer.ts`'s `fadeStep`/`duckStep` pure
 * envelope steps, but exponential (a fixed *time constant*, not a fixed
 * *duration*): each frame moves the remaining gap to the target by a factor
 * of `exp(-dtMs / rampMs)`, so the ramp is exactly frame-rate independent
 * (two half-steps compose to the same result as one full step) and never
 * overshoots.
 *
 * Snaps straight to `target.volume` instead of ramping when:
 *  - there is no prior state (a newly-subscribed remote — nothing to glide
 *    from, matches the pre-ramp instant-assignment behaviour);
 *  - `target.instant` is set (a state cutover, not a spatial change); or
 *  - `target.zoneKey` differs from the prior tick's — the zone gate moved
 *    (room entry/exit, room-to-room) and the privacy invariant requires an
 *    instant cut, never a glide, so a private conversation can never leak
 *    through a half-second ramp at the doorway.
 */
export function rampVolume(
  prev: VolumeRampState | undefined,
  target: ZonedVolume,
  dtMs: number,
  rampMs: number = VOICE_RAMP_MS
): VolumeRampState {
  if (!prev || target.instant || prev.zoneKey !== target.zoneKey) {
    return { applied: target.volume, zoneKey: target.zoneKey };
  }
  if (rampMs <= 0) {
    return { applied: target.volume, zoneKey: target.zoneKey };
  }
  // Negative dt (clock skew) is treated as zero elapsed time — no movement —
  // matching fadeStep/duckStep's dt clamping.
  const factor = Math.exp(-Math.max(0, dtMs) / rampMs);
  const applied = target.volume + (prev.applied - target.volume) * factor;
  return { applied, zoneKey: target.zoneKey };
}

/**
 * Advance every subscribed remote's ramp state one frame. Ids no longer
 * present in `targets` (unsubscribed remotes) are dropped, not carried
 * forward, so ramp state never leaks past a subscription's lifetime.
 */
export function rampVolumes(
  prev: ReadonlyMap<string, VolumeRampState>,
  targets: ReadonlyMap<string, ZonedVolume>,
  dtMs: number,
  rampMs: number = VOICE_RAMP_MS
): Map<string, VolumeRampState> {
  const out = new Map<string, VolumeRampState>();
  for (const [id, target] of targets) {
    out.set(id, rampVolume(prev.get(id), target, dtMs, rampMs));
  }
  return out;
}
