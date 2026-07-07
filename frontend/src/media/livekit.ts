/**
 * LiveKit client layer (matches Codex's backend).
 *  - World room  `world:<spaceId>`  : mic only, volume scaled by 2D distance (proximity audio).
 *  - Private room `room:<roomId>`   : cam + mic, remote video surfaced for avatar bubbles.
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
  computeVolumes,
  subscribeAction,
  unsubscribeAction,
  worldRoomName,
  roomRoomName,
  stageRoomName,
  type RoomMode,
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
    const vols = computeVolumes(p.players, this.selfId, remoteIds, AUDIO_CUTOFF, stagePerformerIds);
    if (!vols) return;
    for (const [id, el] of this.audioEls) el.volume = vols.get(id) ?? 0;
    // Surface the computed world-audio volumes on the bus unconditionally:
    // SfxBridge ducks the ambient bed against them in production, and the
    // Playwright suite asserts zone isolation through the same event (it needs
    // no build-flag gate — the payload is derived purely from broadcast
    // positions, never from RTC internals).
    bus.emit("audio-volumes", { volumes: Object.fromEntries(vols) });
  }

  setMicEnabled(on: boolean) {
    void this.room?.localParticipant.setMicrophoneEnabled(on);
  }

  async stop() {
    this.offPositions?.();
    speakingState.clear("world");
    this.audioEls.forEach((el) => el.remove());
    this.audioEls.clear();
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
  private listeners = new Set<(tracks: RoomTrack[]) => void>();
  private roomListeners = new Set<() => void>();
  private tracks = new Map<string, MediaStreamTrack>();
  private audioEls = new Map<string, HTMLAudioElement>();
  private selfId = "";

  /**
   * The underlying LiveKit Room, surfaced for the meeting grid
   * (@livekit/components-react needs the Room object, not raw tracks).
   * Null while not seated / media unavailable — the grid then falls back to
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

  async join(roomId: string, selfId: string) {
    if (this.room) return;
    this.selfId = selfId;
    try {
      const { token, url } = await fetchToken(roomRoomName(roomId));
      const { Room, RoomEvent, Track } = await import("livekit-client");
      const room = new Room({
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.setRoom(room);
      wireTrackRouting(room, { RoomEvent, Track }, "room-av", {
        surfaceVideo: (id, t) => {
          this.tracks.set(id, t);
          this.emit();
        },
        dropVideo: (id) => {
          this.tracks.delete(id);
          this.emit();
        },
        attachAudio: (id, el) => this.audioEls.set(id, el),
        detachAudio: (id) => {
          this.audioEls.get(id)?.remove();
          this.audioEls.delete(id);
        },
      });
      room.on(RoomEvent.ParticipantDisconnected, (p) => {
        this.tracks.delete(p.identity);
        this.audioEls.get(p.identity)?.remove();
        this.audioEls.delete(p.identity);
        this.emit();
      });
      await room.connect(url, token);
      // Respect the player's sticky mic/cam mute (global control bar, PRD 20) so a
      // muted walker stays muted when they sit into a meeting, and vice versa.
      const wanted = getMediaPrefs();
      await room.localParticipant.setCameraEnabled(wanted.camOn);
      await room.localParticipant.setMicrophoneEnabled(wanted.micOn);
      const localVideo = room.localParticipant
        .getTrackPublications()
        .find((pub) => pub.kind === Track.Kind.Video)?.track?.mediaStreamTrack;
      if (localVideo) {
        this.tracks.set(selfId, localVideo);
        this.emit();
      }
    } catch (e) {
      console.warn("Room video unavailable:", e);
    }
  }

  setMicEnabled(on: boolean) {
    void this.room?.localParticipant.setMicrophoneEnabled(on);
  }
  setCamEnabled(on: boolean) {
    void this.room?.localParticipant.setCameraEnabled(on);
  }

  async leave() {
    this.tracks.clear();
    this.audioEls.forEach((el) => el.remove());
    this.audioEls.clear();
    this.emit();
    await this.room?.disconnect();
    this.setRoom(null);
  }
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
    if (!on) return;
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
