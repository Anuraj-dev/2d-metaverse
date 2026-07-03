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
  computeVolumes,
  subscribeAction,
  unsubscribeAction,
  worldRoomName,
  roomRoomName,
  stageRoomName,
  type RoomMode,
} from "./mediaLogic";

async function fetchToken(
  roomName: string,
  presenterKey?: string
): Promise<{ token: string; url: string }> {
  const res = await fetch(`${serverBase}/api/v1/livekit/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken()}`,
    },
    body: JSON.stringify({ roomName, ...(presenterKey !== undefined ? { presenterKey } : {}) }),
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
    } else if (action === "attach-audio" || action === "attach-audio-silent") {
      const el = track.attach() as HTMLAudioElement;
      el.dataset.identity = participant.identity;
      if (action === "attach-audio-silent") el.volume = 0;
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
      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
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
    const vols = computeVolumes(p.players, this.selfId, remoteIds, AUDIO_CUTOFF);
    if (!vols) return;
    for (const [id, el] of this.audioEls) el.volume = vols.get(id) ?? 0;
    // E2E-only: surface the computed world-audio volumes on the bus so the
    // Playwright suite can assert zone isolation without a live RTC subscription
    // (the flag is statically replaced at build time; prod tree-shakes it out).
    if (import.meta.env.VITE_E2E_HOOK === "1") {
      bus.emit("audio-volumes", { volumes: Object.fromEntries(vols) });
    }
  }

  setMicEnabled(on: boolean) {
    void this.room?.localParticipant.setMicrophoneEnabled(on);
  }

  async stop() {
    this.offPositions?.();
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
      await room.localParticipant.setCameraEnabled(true);
      await room.localParticipant.setMicrophoneEnabled(true);
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

/* ----------------------------- Stage video ----------------------------- */
class StageVideo {
  private room: LKRoom | null = null;
  private listeners = new Set<(tracks: RoomTrack[]) => void>();
  private tracks = new Map<string, MediaStreamTrack>();
  private audioEls = new Map<string, HTMLAudioElement>();
  private selfId = "";

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

  async joinAsAudience(spaceId: string, selfId: string) {
    if (this.room) return;
    this.selfId = selfId;
    try {
      const { token, url } = await fetchToken(stageRoomName(spaceId));
      const { Room, RoomEvent, Track } = await import("livekit-client");
      const room = new Room();
      this.room = room;
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
    } catch (e) {
      console.warn("Stage (audience) unavailable:", e);
    }
  }

  async joinAsPresenter(spaceId: string, selfId: string, presenterKey: string) {
    if (this.room) return;
    this.selfId = selfId;
    try {
      const { token, url } = await fetchToken(stageRoomName(spaceId), presenterKey);
      const { Room, RoomEvent, Track } = await import("livekit-client");
      const room = new Room({
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.room = room;
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
      await room.localParticipant.setCameraEnabled(true);
      await room.localParticipant.setMicrophoneEnabled(true);
      const localVideo = room.localParticipant
        .getTrackPublications()
        .find((pub) => pub.kind === Track.Kind.Video)?.track?.mediaStreamTrack;
      if (localVideo) {
        this.tracks.set(selfId, localVideo);
        this.emit();
      }
    } catch (e) {
      console.warn("Stage (presenter) unavailable:", e);
    }
  }

  async leave() {
    this.tracks.clear();
    this.audioEls.forEach((el) => el.remove());
    this.audioEls.clear();
    this.emit();
    await this.room?.disconnect();
    this.room = null;
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
