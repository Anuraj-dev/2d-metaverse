import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setMediaPrefs } from "./mediaPrefs";

/**
 * RoomVideo join failure path (PRD 23 review fix): a failed token fetch or
 * LiveKit connect must fully unwind — `lkRoom` back to null (via the same
 * setRoom path, so onRoomChanged subscribers fire and MeetingGrid falls back
 * to roster tiles) and a later join() retries with a fresh connection instead
 * of short-circuiting on the dead Room. `livekit-client` is mocked at the
 * module seam (same pattern as livekit.stage.test.ts) — assertions target the
 * public lkRoom/onRoomChanged surface, never RTC internals.
 */
const lk = vi.hoisted(() => {
  const connect = vi.fn(async () => {});
  const disconnect = vi.fn(async () => {});
  const localParticipant = {
    setMicrophoneEnabled: vi.fn(async () => {}),
    setCameraEnabled: vi.fn(async () => {}),
    setScreenShareEnabled: vi.fn(async () => {}),
    getTrackPublications: () => [],
  };
  // Room event handlers by name, so tests can replay what LiveKit would emit.
  const handlers = new Map<string, (...args: unknown[]) => void>();
  class FakeRoom {
    localParticipant = localParticipant;
    on(event: string, cb: (...args: unknown[]) => void) {
      handlers.set(event, cb);
      return this;
    }
    connect = connect;
    disconnect = disconnect;
  }
  return { connect, disconnect, localParticipant, handlers, FakeRoom };
});

vi.mock("livekit-client", () => ({
  Room: lk.FakeRoom,
  RoomEvent: {
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
    ParticipantDisconnected: "participantDisconnected",
    LocalTrackUnpublished: "localTrackUnpublished",
    ActiveSpeakersChanged: "activeSpeakersChanged",
  },
  Track: {
    Kind: { Audio: "audio", Video: "video" },
    Source: { ScreenShare: "screen_share" },
  },
}));
vi.mock("../net/auth", () => ({
  serverBase: "http://backend.test",
  authToken: () => "jwt",
}));

import { roomVideo } from "./livekit";
import { localModeration } from "./localModeration";

const okTokenFetch = () =>
  vi.fn(async () => ({
    ok: true,
    json: async () => ({ livekitToken: "tok", url: "wss://lk.test" }),
  }));

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("fetch", okTokenFetch());
  setMediaPrefs({ micOn: true, camOn: true });
  lk.connect.mockReset().mockResolvedValue(undefined);
  lk.disconnect.mockReset().mockResolvedValue(undefined);
  lk.localParticipant.setMicrophoneEnabled.mockClear().mockResolvedValue(undefined);
  lk.localParticipant.setCameraEnabled.mockClear().mockResolvedValue(undefined);
  lk.localParticipant.setScreenShareEnabled.mockClear().mockResolvedValue(undefined);
  lk.handlers.clear();
  // The failure paths log via console.warn by design — keep test output clean.
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  // roomVideo is a singleton — always return it to the left state between cases.
  await roomVideo.leave();
  warnSpy.mockRestore();
  vi.unstubAllGlobals();
});

describe("RoomVideo.join failure cleanup", () => {
  it("joins a room receive-only on a consent-safe cold start", async () => {
    setMediaPrefs({ micOn: false, camOn: false });

    await roomVideo.join("42");

    expect(roomVideo.lkRoom).not.toBeNull();
    expect(lk.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(lk.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  });

  it("replays devices explicitly enabled earlier in the browser session", async () => {
    setMediaPrefs({ micOn: true, camOn: true });

    await roomVideo.join("42");

    expect(lk.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(lk.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
  });

  it("a failed connect resets lkRoom to null and notifies onRoomChanged", async () => {
    lk.connect.mockRejectedValueOnce(new Error("connect failed"));
    const changed = vi.fn();
    const off = roomVideo.onRoomChanged(changed);

    await roomVideo.join("42");

    // Roster fallback engages: no dead Room is left on the public surface.
    expect(roomVideo.lkRoom).toBeNull();
    // setRoom fired for both the optimistic set and the unwind back to null.
    expect(changed).toHaveBeenCalled();
    off();
  });

  it("a failed token fetch leaves lkRoom null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    await roomVideo.join("42");
    expect(roomVideo.lkRoom).toBeNull();
  });

  it("a second join() after a failure attempts a fresh connect (no short-circuit)", async () => {
    lk.connect.mockRejectedValueOnce(new Error("connect failed"));
    await roomVideo.join("42");
    expect(roomVideo.lkRoom).toBeNull();

    await roomVideo.join("42");
    expect(lk.connect).toHaveBeenCalledTimes(2);
    expect(roomVideo.lkRoom).not.toBeNull();
  });

  it("a successful join keeps the room even if applying media prefs fails", async () => {
    lk.localParticipant.setCameraEnabled.mockRejectedValueOnce(
      new Error("getUserMedia denied")
    );
    await roomVideo.join("42");
    // Pref failure is not a connection failure: stay on the LiveKit path.
    expect(roomVideo.lkRoom).not.toBeNull();
  });
});

/** A remote audio track as LiveKit hands it to TrackSubscribed. */
function remoteAudio() {
  const el = document.createElement("audio");
  return { el, track: { kind: "audio", attach: () => el, detach: () => [el] } };
}

describe("RoomVideo screen-share audio", () => {
  it("asks the picker for tab/system audio and publishes it as music", async () => {
    await roomVideo.join("42");

    await roomVideo.setScreenShareEnabled(true);

    const [on, capture, publish] = lk.localParticipant.setScreenShareEnabled.mock.calls[0] as unknown as [
      boolean,
      { audio: MediaTrackConstraints; systemAudio: string; suppressLocalAudioPlayback: boolean },
      { audioPreset: unknown; dtx: boolean; forceStereo: boolean },
    ];
    expect(on).toBe(true);
    // Voice processing would mangle music/video sound — capture it raw.
    expect(capture.audio).toMatchObject({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(capture.systemAudio).toBe("include");
    // The presenter keeps hearing their own tab.
    expect(capture.suppressLocalAudioPlayback).toBe(false);
    expect(publish).toMatchObject({ audioPreset: { maxBitrate: 128_000 }, dtx: false, forceStereo: true });
  });

  it("keeps a peer's mic and shared audio as separate elements", async () => {
    await roomVideo.join("42");
    const subscribed = lk.handlers.get("trackSubscribed")!;
    const unsubscribed = lk.handlers.get("trackUnsubscribed")!;
    const peer = { identity: "p1" };
    const mic = remoteAudio();
    const share = remoteAudio();

    subscribed(mic.track, { trackSid: "TR_mic" }, peer);
    subscribed(share.track, { trackSid: "TR_share" }, peer);
    unsubscribed(mic.track, { trackSid: "TR_mic" }, peer);

    // Stopping the mic must not cut the shared tab's sound.
    expect(mic.el.isConnected).toBe(false);
    expect(share.el.isConnected).toBe(true);
  });

  it("silences a muted peer's mic and shared audio alike", async () => {
    await roomVideo.join("42");
    const subscribed = lk.handlers.get("trackSubscribed")!;
    const peer = { identity: "p1" };
    const mic = remoteAudio();
    const share = remoteAudio();
    subscribed(mic.track, { trackSid: "TR_mic" }, peer);
    subscribed(share.track, { trackSid: "TR_share" }, peer);

    localModeration.toggleMute("p1");

    expect(mic.el.volume).toBe(0);
    expect(share.el.volume).toBe(0);
    localModeration.toggleMute("p1");
    expect(mic.el.volume).toBe(1);
  });
});
