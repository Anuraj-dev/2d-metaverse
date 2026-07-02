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
  worldRoomName,
  roomRoomName,
  stageRoomName,
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

/* ----------------------------- World audio ----------------------------- */
class WorldAudio {
  private room: LKRoom | null = null;
  private audioEls = new Map<string, HTMLAudioElement>();
  private selfId = "";
  private offPositions?: () => void;

  async start(spaceId: string, selfId: string) {
    this.selfId = selfId;
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
      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach() as HTMLAudioElement;
        el.dataset.identity = participant.identity;
        el.volume = 0;
        document.body.appendChild(el);
        this.audioEls.set(participant.identity, el);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        track.detach().forEach((el) => el.remove());
        this.audioEls.get(participant.identity)?.remove();
        this.audioEls.delete(participant.identity);
      });
      room.on(RoomEvent.ParticipantDisconnected, (p) => {
        this.audioEls.get(p.identity)?.remove();
        this.audioEls.delete(p.identity);
      });
      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      this.offPositions = bus.on("positions", (p: PositionsPayload) =>
        this.updateVolumes(p)
      );
    } catch (e) {
      console.warn("World audio unavailable:", e);
    }
  }

  private updateVolumes(p: PositionsPayload) {
    const vols = computeVolumes(p.players, this.selfId, this.audioEls.keys(), AUDIO_CUTOFF);
    if (!vols) return;
    for (const [id, el] of this.audioEls) el.volume = vols.get(id) ?? 0;
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
      this.room = room;
      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind === Track.Kind.Video) {
          this.tracks.set(participant.identity, track.mediaStreamTrack);
          this.emit();
        } else if (track.kind === Track.Kind.Audio) {
          const el = track.attach() as HTMLAudioElement;
          document.body.appendChild(el);
          this.audioEls.set(participant.identity, el);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        if (track.kind === Track.Kind.Video) {
          this.tracks.delete(participant.identity);
          this.emit();
          return;
        }
        track.detach().forEach((el) => el.remove());
        this.audioEls.get(participant.identity)?.remove();
        this.audioEls.delete(participant.identity);
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
    this.room = null;
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
      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind === Track.Kind.Video) {
          this.tracks.set(participant.identity, track.mediaStreamTrack);
          this.emit();
        } else if (track.kind === Track.Kind.Audio) {
          const el = track.attach() as HTMLAudioElement;
          document.body.appendChild(el);
          this.audioEls.set(participant.identity, el);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        if (track.kind === Track.Kind.Video) {
          this.tracks.delete(participant.identity);
          this.emit();
          return;
        }
        track.detach().forEach((el) => el.remove());
        this.audioEls.get(participant.identity)?.remove();
        this.audioEls.delete(participant.identity);
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
      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind === Track.Kind.Video) {
          this.tracks.set(participant.identity, track.mediaStreamTrack);
          this.emit();
        } else if (track.kind === Track.Kind.Audio) {
          const el = track.attach() as HTMLAudioElement;
          document.body.appendChild(el);
          this.audioEls.set(participant.identity, el);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        if (track.kind === Track.Kind.Video) {
          this.tracks.delete(participant.identity);
          this.emit();
          return;
        }
        track.detach().forEach((el) => el.remove());
        this.audioEls.get(participant.identity)?.remove();
        this.audioEls.delete(participant.identity);
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
  players: { id: string; self: boolean; x: number; y: number }[];
}

export const worldAudio = new WorldAudio();
export const roomVideo = new RoomVideo();
export const stageVideo = new StageVideo();
