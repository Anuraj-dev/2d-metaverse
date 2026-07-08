/**
 * LiveKit client layer (matches Codex's backend).
 *  - World room  `world:<spaceId>`  : mic only, volume scaled by 2D distance (proximity audio).
 *  - Private room `room:<roomId>`   : cam + mic + screen share, rendered by the meeting grid.
 * LiveKit participant identity === playerId, so positions/seat events map 1:1 to tracks.
 */
// `livekit-client` is loaded dynamically (only when audio/video is actually used)
// so it stays out of the initial bundle. Types are erased type-only imports.
import type { Room as LKRoom } from "livekit-client";
import { serverBase, authToken } from "../net/auth";
import { bus } from "../game/eventBus";
import {
  AUDIO_CUTOFF,
  STAGE_VOLUME,
  computeZonedVolumes,
  rampVolumes,
  subscribeAction,
  unsubscribeAction,
  worldRoomName,
  roomRoomName,
  stageRoomName,
  type RoomMode,
  type VolumeRampState,
} from "./mediaLogic";
import { speakingState } from "./speakingState";
import { getMediaPrefs } from "./mediaPrefs";

/**
 * Identities whose live stage audio the local client is currently subscribed to
 * (PRD 17). The world proximity room mutes these performers' proximity tracks so a
 * listener standing near an on-air performer never hears a doubled signal — the
 * broadcast (fixed volume) wins. Updated by `StageVideo` as stage audio tracks
 * attach/detach; read by `WorldAudio` on every positions tick.
 */
let stagePerformerIds: ReadonlySet<string> = new Set();

async function fetchToken(
  roomName: string,
  opts?: { stagePublish?: boolean }
): Promise<{ token: string; url: string }> {
  const res = await fetch(`${serverBase}/api/v1/livekit/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken()}`,
    },
    body: JSON.stringify({ roomName, ...(opts?.stagePublish ? { stagePublish: true } : {}) }),
  });
  if (!res.ok) throw new Error(`livekit token ${res.status}`);
  // Backend returns { livekitToken, url }.
  const data = (await res.json()) as { livekitToken: string; url: string };
  return { token: data.livekitToken, url: data.url };
}

/* --------------------------- Track routing glue -------------------------- */
type LKModule = Pick<typeof import("livekit-client"), "RoomEvent" | "Track">;

/** Where routed tracks land — each room class supplies its own containers. */
interface TrackSinks {
  surfaceVideo(identity: string, track: MediaStreamTrack): void;
  dropVideo(identity: string): void;
  attachAudio(identity: string, el: HTMLAudioElement): void;
  detachAudio(identity: string): void;
}

/**
 * Wire a room's TrackSubscribed/TrackUnsubscribed events through the pure
 * mediaLogic routing decisions. The single place attach-vs-surface is decided —
 * the classes below only say which mode they are and where tracks land.
 */
function wireTrackRouting(
  room: LKRoom,
  lk: LKModule,
  mode: RoomMode,
  sinks: TrackSinks
) {
  const { RoomEvent, Track } = lk;
  room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
    // Unknown-kind tracks were never routed; keep skipping them.
    if (track.kind !== Track.Kind.Audio && track.kind !== Track.Kind.Video) return;
    const kind = track.kind === Track.Kind.Video ? "video" : "audio";
    const action = subscribeAction(kind, mode);
    if (action === "surface-video") {
      sinks.surfaceVideo(participant.identity, track.mediaStreamTrack);
    } else if (
      action === "attach-audio" ||
      action === "attach-audio-silent" ||
      action === "attach-audio-fixed"
    ) {
      const el = track.attach() as HTMLAudioElement;
      el.dataset.identity = participant.identity;
      if (action === "attach-audio-silent") el.volume = 0;
      else if (action === "attach-audio-fixed") el.volume = STAGE_VOLUME;
      document.body.appendChild(el);
      sinks.attachAudio(participant.identity, el);
    }
    // "ignore": world audio has no use for video tracks.
  });
  room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
    const kind = track.kind === Track.Kind.Video ? "video" : "audio";
    const action = unsubscribeAction(kind, mode);
    if (action === "drop-video") {
      sinks.dropVideo(participant.identity);
      return;
    }
    track.detach().forEach((el) => el.remove());
    sinks.detachAudio(participant.identity);
  });
}

/* ----------------------------- World audio ----------------------------- */
class WorldAudio {
  private room: LKRoom | null = null;
  private audioEls = new Map<string, HTMLAudioElement>();
  private selfId = "";
  private offPositions?: () => void;
  // Per-remote volume-ramp state (PRD 21) — the applied `<audio>` gain glides
  // toward its zone-aware target over `VOICE_RAMP_MS`, except zone/door cuts,
  // which `rampVolumes` snaps instantly (see mediaLogic.ts `rampVolume`).
  private rampState = new Map<string, VolumeRampState>();
  private lastVolumeTickAt = 0;

  async start(spaceId: string, selfId: string) {
    this.selfId = selfId;
    // Price volumes off every positions tick regardless of whether the LiveKit
    // connection came up: the zone-aware volume decision is derived purely from
    // broadcast positions, so it stays observable (see `updateVolumes`) even
    // when media is unavailable. Subscribing here (not after connect) also means
    // a slow/failed connect never drops a positions tick on the floor.
    this.offPositions = bus.on("positions", (p: PositionsPayload) =>
      this.updateVolumes(p)
    );
    try {
      const { token, url } = await fetchToken(worldRoomName(spaceId));
      const { Room, RoomEvent, Track } = await import("livekit-client");
      const room = new Room({
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.room = room;
      wireTrackRouting(room, { RoomEvent, Track }, "world-audio", {
        surfaceVideo: () => {},
        dropVideo: () => {},
        attachAudio: (id, el) => this.audioEls.set(id, el),
        detachAudio: (id) => {
          this.audioEls.get(id)?.remove();
          this.audioEls.delete(id);
        },
      });
      room.on(RoomEvent.ParticipantDisconnected, (p) => {
        this.audioEls.get(p.identity)?.remove();
        this.audioEls.delete(p.identity);
      });
      // Surface LiveKit's active-speaker set (remotes + local participant) on the
      // shared speaking-state seam; the pure mixer decides the duck. Identity ===
      // playerId, so it lines up 1:1 with the proximity-volume map.
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        speakingState.setSpeakers(
          "world",
          speakers.map((s) => s.identity)
        );
      });
      await room.connect(url, token);
      // Respect the player's sticky mute (global control bar, PRD 20) instead of
      // force-unmuting on every world (re)join.
      await room.localParticipant.setMicrophoneEnabled(getMediaPrefs().micOn);
    } catch (e) {
      console.warn("World audio unavailable:", e);
    }
  }

  private updateVolumes(p: PositionsPayload) {
    // Compute the zone-aware volume for every remote (not just the subscribed
    // set) so the decision is fully observable; apply it only to remotes we
    // actually have an audio element for.
    const remoteIds = p.players
      .filter((pl) => !pl.self && pl.id !== this.selfId)
      .map((pl) => pl.id);
    // Mute any remote who is a live stage performer: the listener already hears
    // them server-wide off the stage room, so their proximity track is deduped.
    const zoned = computeZonedVolumes(
      p.players,
      this.selfId,
      remoteIds,
      AUDIO_CUTOFF,
      stagePerformerIds
    );
    if (!zoned) return;
    // PRD 21: the AUDIBLE gain glides toward the target over VOICE_RAMP_MS for
    // same-zone distance changes, but snaps instantly at a zone/door boundary
    // (rampVolumes/rampVolume). dt is real elapsed time (not the nominal tick
    // period) so the ramp stays correct under jitter/throttled tabs.
    const now = performance.now();
    const dt = this.lastVolumeTickAt === 0 ? 0 : now - this.lastVolumeTickAt;
    this.lastVolumeTickAt = now;
    this.rampState = rampVolumes(this.rampState, zoned, dt);
    for (const [id, el] of this.audioEls) el.volume = this.rampState.get(id)?.applied ?? 0;
    // Surface the computed world-audio TARGET volumes on the bus unconditionally
    // (unramped — the zone-aware decision itself, not the smoothed audible
    // gain): SfxBridge ducks the ambient bed against them in production, and the
    // Playwright suite asserts zone isolation through the same event (it needs
    // no build-flag gate — the payload is derived purely from broadcast
    // positions, never from RTC internals).
    const vols = new Map<string, number>();
    for (const [id, z] of zoned) vols.set(id, z.volume);
    bus.emit("audio-volumes", { volumes: Object.fromEntries(vols) });
  }

  setMicEnabled(on: boolean) {
    void this.room?.localParticipant.setMicrophoneEnabled(on);
  }

  /** The local mic MediaStreamTrack while connected (for the HUD level meter). */
  localAudioTrack(): MediaStreamTrack | null {
    return localAudioTrackOf(this.room);
  }

  async stop() {
    this.offPositions?.();
    speakingState.clear("world");
    this.audioEls.forEach((el) => el.remove());
    this.audioEls.clear();
    this.rampState = new Map();
    this.lastVolumeTickAt = 0;
    await this.room?.disconnect();
    this.room = null;
  }
}

/* ----------------------------- Room video ------------------------------ */
export interface RoomTrack {
  identity: string;
  track: MediaStreamTrack;
  self: boolean;
}

class RoomVideo {
  private room: LKRoom | null = null;
  private roomListeners = new Set<() => void>();
  private shareListeners = new Set<() => void>();
  private audioEls = new Map<string, HTMLAudioElement>();
  private sharing = false;

  /**
   * The underlying LiveKit Room, surfaced for the meeting grid
   * (@livekit/components-react needs the Room object, not raw tracks — the grid
   * reads camera + screen-share tracks straight off it via `useTracks`). Null
   * while not seated / media unavailable — the grid then falls back to
   * roster-only tiles.
   */
  get lkRoom(): LKRoom | null {
    return this.room;
  }

  /** Subscribe to lkRoom changing (join/leave). useSyncExternalStore-shaped. */
  onRoomChanged = (cb: () => void): (() => void) => {
    this.roomListeners.add(cb);
    return () => this.roomListeners.delete(cb);
  };

  private setRoom(room: LKRoom | null) {
    this.room = room;
    this.roomListeners.forEach((cb) => cb());
  }

  async join(roomId: string) {
    if (this.room) return;
    // Definitely assigned when the try completes normally (the catch returns).
    let room: LKRoom;
    try {
      const { token, url } = await fetchToken(roomRoomName(roomId));
      const { Room, RoomEvent, Track } = await import("livekit-client");
      room = new Room({
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.setRoom(room);
      // Remote camera + screen-share video is subscribed by the SDK and read
      // directly off the Room by the meeting grid (MeetingGrid `useTracks`); this
      // layer only routes room audio (attach) — the video sinks are intentionally
      // no-ops here.
      wireTrackRouting(room, { RoomEvent, Track }, "room-av", {
        surfaceVideo: () => {},
        dropVideo: () => {},
        attachAudio: (id, el) => this.audioEls.set(id, el),
        detachAudio: (id) => {
          this.audioEls.get(id)?.remove();
          this.audioEls.delete(id);
        },
      });
      room.on(RoomEvent.ParticipantDisconnected, (p) => {
        this.audioEls.get(p.identity)?.remove();
        this.audioEls.delete(p.identity);
      });
      // A browser-initiated "Stop sharing" unpublishes the screen-share track
      // without going through our toggle — reflect it so the control bar's
      // sharing state stays truthful (PRD 23, user story 3).
      room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (pub.source === Track.Source.ScreenShare) this.setSharing(false);
      });
      // Feed the shared speaking-state seam so the HUD speaking rings light up for
      // meeting/seated talkers too (identity === playerId), same as the world room.
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        speakingState.setSpeakers(
          "room",
          speakers.map((s) => s.identity)
        );
      });
      await room.connect(url, token);
    } catch (e) {
      // A failed token fetch/connect must not leave the dead Room behind: a
      // non-null `lkRoom` short-circuits every later join() and keeps
      // MeetingGrid on the LiveKit path instead of the roster fallback. Unwind
      // through leave() so `setRoom(null)` notifies onRoomChanged subscribers
      // and the next join() retries with a fresh connection.
      console.warn("Room video unavailable:", e);
      await this.leave();
      return;
    }
    // Respect the player's sticky mic/cam mute (global control bar, PRD 20) so a
    // muted walker stays muted when they sit into a meeting, and vice versa.
    // Pref application failures (e.g. a getUserMedia denial) must NOT tear down
    // the connected room — the meeting still works receive-only.
    try {
      const wanted = getMediaPrefs();
      await room.localParticipant.setCameraEnabled(wanted.camOn);
      await room.localParticipant.setMicrophoneEnabled(wanted.micOn);
    } catch (e) {
      console.warn("Applying media prefs to room failed:", e);
    }
  }

  setMicEnabled(on: boolean) {
    void this.room?.localParticipant.setMicrophoneEnabled(on);
  }
  setCamEnabled(on: boolean) {
    void this.room?.localParticipant.setCameraEnabled(on);
  }

  /* -------------------------- Screen share (PRD 23) ------------------------- */
  /** Whether the local participant is currently publishing a screen share. */
  isScreenSharing(): boolean {
    return this.sharing;
  }

  /** Subscribe to sharing-state changes. useSyncExternalStore-shaped. */
  onScreenShareChanged = (cb: () => void): (() => void) => {
    this.shareListeners.add(cb);
    return () => this.shareListeners.delete(cb);
  };

  private setSharing(on: boolean) {
    if (this.sharing === on) return;
    this.sharing = on;
    this.shareListeners.forEach((cb) => cb());
  }

  /**
   * Start/stop the meeting screen share. Publishes through LiveKit's screen-share
   * API on the meeting room's local participant; the grid renders the resulting
   * `ScreenShare` track like any other. A no-op (stays not-sharing) when the room
   * is unavailable or when the user cancels the browser picker.
   */
  async setScreenShareEnabled(on: boolean): Promise<void> {
    const room = this.room;
    if (!room) return;
    try {
      await room.localParticipant.setScreenShareEnabled(on);
      this.setSharing(on);
    } catch (e) {
      // Picker cancellation / permission denial: never leave a phantom "sharing".
      this.setSharing(false);
      console.warn("Screen share toggle failed:", e);
    }
  }

  /** The local mic MediaStreamTrack while seated (for the HUD level meter). */
  localAudioTrack(): MediaStreamTrack | null {
    return localAudioTrackOf(this.room);
  }

  async leave() {
    this.setSharing(false);
    this.audioEls.forEach((el) => el.remove());
    this.audioEls.clear();
    speakingState.clear("room");
    await this.room?.disconnect();
    this.setRoom(null);
  }
}

/** Pull the local participant's audio MediaStreamTrack from a room, or null. */
function localAudioTrackOf(room: LKRoom | null): MediaStreamTrack | null {
  const pubs = room?.localParticipant.getTrackPublications() ?? [];
  for (const p of pubs) {
    const t = p.track?.mediaStreamTrack;
    if (t && t.kind === "audio") return t;
  }
  return null;
}

/* ----------------------------- Stage broadcast ----------------------------- */
/**
 * The stage LiveKit room (`stage:<spaceId>`), used for BOTH the server-wide voice
 * broadcast (PRD 17) and the explicit "Go Live" video. One connection per client
 * (a participant can't join the same room twice), so this holds a single `mode`:
 *  - "audience": subscribe-only. Every non-private-room client is here; remote
 *    performers attach at the FIXED `STAGE_VOLUME` ("stage-audience" routing).
 *  - "performer": reconnected with a position-validated publish token; publishes
 *    mic (voice) and optionally cam ("Go Live"). Still subscribes to co-performers.
 * Going on/off air reconnects with the appropriate token. Both connections feed
 * the shared speaking-state seam so a broadcasting performer ducks listeners' beds.
 */
class StageVideo {
  private room: LKRoom | null = null;
  private listeners = new Set<(tracks: RoomTrack[]) => void>();
  private tracks = new Map<string, MediaStreamTrack>();
  private audioEls = new Map<string, HTMLAudioElement>();
  private selfId = "";
  private mode: "none" | "audience" | "performer" = "none";

  onTracks(cb: (tracks: RoomTrack[]) => void) {
    this.listeners.add(cb);
    cb(this.snapshot());
    return () => this.listeners.delete(cb);
  }
  private snapshot(): RoomTrack[] {
    return [...this.tracks].map(([identity, track]) => ({
      identity,
      track,
      self: identity === this.selfId,
    }));
  }
  private emit() {
    const snap = this.snapshot();
    this.listeners.forEach((cb) => cb(snap));
  }
  /** Publish the live-performer set for the world room's proximity dedupe. */
  private syncPerformers() {
    stagePerformerIds = new Set(this.audioEls.keys());
  }

  private async open(spaceId: string, selfId: string, opts: { publish: boolean; video: boolean }) {
    this.selfId = selfId;
    try {
      const { token, url } = await fetchToken(
        stageRoomName(spaceId),
        opts.publish ? { stagePublish: true } : undefined,
      );
      const { Room, RoomEvent, Track } = await import("livekit-client");
      const room = opts.publish
        ? new Room({
            audioCaptureDefaults: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          })
        : new Room();
      this.room = room;
      wireTrackRouting(room, { RoomEvent, Track }, "stage-audience", {
        surfaceVideo: (id, t) => {
          this.tracks.set(id, t);
          this.emit();
        },
        dropVideo: (id) => {
          this.tracks.delete(id);
          this.emit();
        },
        attachAudio: (id, el) => {
          this.audioEls.set(id, el);
          this.syncPerformers();
        },
        detachAudio: (id) => {
          this.audioEls.get(id)?.remove();
          this.audioEls.delete(id);
          this.syncPerformers();
        },
      });
      room.on(RoomEvent.ParticipantDisconnected, (p) => {
        this.tracks.delete(p.identity);
        this.audioEls.get(p.identity)?.remove();
        this.audioEls.delete(p.identity);
        this.syncPerformers();
        this.emit();
      });
      // A broadcasting performer counts as an audible speaking peer for every
      // subscribed listener's duck (PRD 15 speaking-state seam, "stage" source).
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        speakingState.setSpeakers(
          "stage",
          speakers.map((s) => s.identity),
        );
      });
      await room.connect(url, token);
      if (opts.publish) {
        // Replay the sticky mic/cam prefs (global control bar, PRD 20) instead of
        // coming up hot: going on air while muted yields an on-air-but-muted state
        // that the bar can unmute — the bar stays the single control surface.
        const wanted = getMediaPrefs();
        await room.localParticipant.setMicrophoneEnabled(wanted.micOn);
        if (opts.video && wanted.camOn) await this.applyCam(true);
      }
    } catch (e) {
      console.warn("Stage unavailable:", e);
    }
  }

  /**
   * Enable/disable the performer camera and keep the local self tile in sync
   * (local tracks never fire TrackSubscribed, so surfacing is done here).
   */
  private async applyCam(on: boolean) {
    const room = this.room;
    if (!room) return;
    await room.localParticipant.setCameraEnabled(on);
    if (!on) {
      // Retract the surfaced self preview immediately (as the off-air path does):
      // StageScreen renders the cached track while live, so leaving it in place
      // would keep a stale "You (live)" tile up after a bar cam-off.
      if (this.tracks.delete(this.selfId)) this.emit();
      return;
    }
    const { Track } = await import("livekit-client");
    const localVideo = room.localParticipant
      .getTrackPublications()
      .find((pub) => pub.kind === Track.Kind.Video)?.track?.mediaStreamTrack;
    if (localVideo) {
      this.tracks.set(this.selfId, localVideo);
      this.emit();
    }
  }

  /** Subscribe-only audience connection — every non-private-room client (PRD 17). */
  async joinAsAudience(spaceId: string, selfId: string) {
    if (this.room) return;
    await this.open(spaceId, selfId, { publish: false, video: false });
    this.mode = "audience";
  }

  /** Voice broadcast: reconnect with a publish token and go live on mic. */
  async goOnAir(spaceId: string, selfId: string) {
    if (this.mode === "performer") return;
    await this.leave();
    await this.open(spaceId, selfId, { publish: true, video: false });
    this.mode = "performer";
  }

  /**
   * Explicit keyless "Go Live" video: publish cam + mic (adds cam if already on
   * air). The sticky cam pref wins (PRD 20 one-surface contract): going live with
   * the bar's camera off comes up video-muted until the bar turns it on.
   */
  async goLive(spaceId: string, selfId: string) {
    if (this.mode === "performer" && this.room) {
      await this.applyCam(getMediaPrefs().camOn);
      return;
    }
    await this.leave();
    await this.open(spaceId, selfId, { publish: true, video: true });
    this.mode = "performer";
  }

  /**
   * Global control-bar fan-out (PRD 20). Only a performer publishes — audience
   * tokens can't publish, so applying a toggle there must stay a no-op rather
   * than trigger a doomed publish attempt.
   */
  setMicEnabled(on: boolean) {
    if (this.mode !== "performer") return;
    void this.room?.localParticipant.setMicrophoneEnabled(on);
  }
  setCamEnabled(on: boolean) {
    if (this.mode !== "performer") return;
    this.applyCam(on).catch((e) => console.warn("Stage camera toggle failed:", e));
  }

  /** Stop broadcasting but stay subscribed to the stage as audience. */
  async goOffAir(spaceId: string, selfId: string) {
    if (this.mode !== "performer") return;
    await this.leave();
    await this.open(spaceId, selfId, { publish: false, video: false });
    this.mode = "audience";
  }

  async leave() {
    this.tracks.clear();
    this.audioEls.forEach((el) => el.remove());
    this.audioEls.clear();
    this.syncPerformers();
    speakingState.clear("stage");
    this.emit();
    await this.room?.disconnect();
    this.room = null;
    this.mode = "none";
  }
}

interface PositionsPayload {
  // `zone` is the per-player audio zone the scene computes from the map's room
  // rectangles (room id, or `OUTDOOR_ZONE`). Optional so payloads predating the
  // zone-audio wiring degrade to outdoor (pure-distance) behaviour.
  players: { id: string; self: boolean; x: number; y: number; zone?: string }[];
}

export const worldAudio = new WorldAudio();
export const roomVideo = new RoomVideo();
export const stageVideo = new StageVideo();

/**
 * The local mic MediaStreamTrack from whichever room currently publishes it —
 * the room/meeting video when seated, else proximity world audio while walking.
 * Consumed by the HUD mic-level meter (PRD 20). Null when neither is connected.
 */
export function localAudioTrack(): MediaStreamTrack | null {
  return roomVideo.localAudioTrack() ?? worldAudio.localAudioTrack();
}
