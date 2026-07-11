import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setMediaPrefs } from "./mediaPrefs";

/**
 * Stage publish path vs the global control bar (PRD 20 review fix): the stage
 * broadcast must sit behind the same sticky-pref + fan-out contract as the world
 * and room publishers. `livekit-client` is mocked at the module seam (same idea as
 * App.test.tsx mocking `media/livekit`), so assertions target which local-participant
 * calls fire — never RTC internals.
 */
const lk = vi.hoisted(() => {
  interface FakePub {
    kind: string;
    track?: { mediaStreamTrack: unknown };
  }
  const pubs: FakePub[] = [];
  const localParticipant = {
    setMicrophoneEnabled: vi.fn(async () => {}),
    setCameraEnabled: vi.fn(async (on: boolean) => {
      // Enabling the camera publishes a local video track, like the real client.
      if (on && pubs.length === 0) {
        pubs.push({ kind: "video", track: { mediaStreamTrack: { id: "self-cam" } } });
      }
    }),
    getTrackPublications: () => pubs,
  };
  class FakeRoom {
    localParticipant = localParticipant;
    on() {
      return this;
    }
    async connect() {}
    async disconnect() {}
  }
  return { pubs, localParticipant, FakeRoom };
});

vi.mock("livekit-client", () => ({
  Room: lk.FakeRoom,
  RoomEvent: {
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
    ParticipantDisconnected: "participantDisconnected",
    ActiveSpeakersChanged: "activeSpeakersChanged",
  },
  Track: { Kind: { Audio: "audio", Video: "video" } },
}));
vi.mock("../net/auth", () => ({
  serverBase: "http://backend.test",
  authToken: () => "jwt",
}));

import { stageVideo, type RoomTrack } from "./livekit";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ livekitToken: "tok", url: "wss://lk.test" }),
    }))
  );
  setMediaPrefs({ micOn: true, camOn: true });
  lk.pubs.length = 0;
  lk.localParticipant.setMicrophoneEnabled.mockClear();
  lk.localParticipant.setCameraEnabled.mockClear();
});
afterEach(async () => {
  // stageVideo is a singleton — return it to "none" between cases.
  await stageVideo.leave();
  vi.unstubAllGlobals();
});

describe("stage publish replays the sticky media prefs (never comes up hot)", () => {
  it("requests no device when stage publish starts in a consent-safe session", async () => {
    setMediaPrefs({ micOn: false, camOn: false });

    await stageVideo.goOnAir("1", "self");

    expect(lk.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(lk.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  });

  it("replays an explicit microphone enable when going on air", async () => {
    setMediaPrefs({ micOn: true });
    await stageVideo.goOnAir("1", "self");
    expect(lk.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
    // Voice broadcast never touches the camera.
    expect(lk.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  });

  it("re-going on air after an off-air interlude still respects a mute set meanwhile", async () => {
    await stageVideo.goOnAir("1", "self");
    setMediaPrefs({ micOn: false });
    await stageVideo.goOffAir("1", "self");
    lk.localParticipant.setMicrophoneEnabled.mockClear();
    await stageVideo.goOnAir("1", "self");
    expect(lk.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  });

  it("goLive with the cam pref off comes up live but video-muted", async () => {
    setMediaPrefs({ micOn: true, camOn: false });
    await stageVideo.goLive("1", "self");
    expect(lk.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
    expect(lk.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  });

  it("goLive with the cam pref on publishes the camera and surfaces the self tile", async () => {
    let tracks: RoomTrack[] = [];
    const off = stageVideo.onTracks((t) => (tracks = t));
    await stageVideo.goLive("1", "self");
    expect(lk.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
    expect(tracks.some((t) => t.self)).toBe(true);
    off();
  });
});

describe("global control-bar fan-out reaches the stage publisher", () => {
  it("setMicEnabled drives the on-air mic", async () => {
    await stageVideo.goOnAir("1", "self");
    lk.localParticipant.setMicrophoneEnabled.mockClear();
    await stageVideo.setMicEnabled(false);
    expect(lk.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
  });

  it("turning the cam on from the bar while live publishes and surfaces the self tile", async () => {
    setMediaPrefs({ camOn: false });
    await stageVideo.goLive("1", "self"); // live, but video-muted per pref
    let tracks: RoomTrack[] = [];
    const off = stageVideo.onTracks((t) => (tracks = t));
    setMediaPrefs({ camOn: true });
    await stageVideo.setCamEnabled(true);
    await vi.waitFor(() => {
      expect(lk.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
      expect(tracks.some((t) => t.self)).toBe(true);
    });
    off();
  });

  it("cam-off from the bar retracts the self tile; cam back on re-surfaces exactly one", async () => {
    let tracks: RoomTrack[] = [];
    const off = stageVideo.onTracks((t) => (tracks = t));
    await stageVideo.goLive("1", "self");
    expect(tracks.filter((t) => t.self)).toHaveLength(1);

    // Bar cam-off: the stale "You (live)" preview must drop from the snapshot.
    await stageVideo.setCamEnabled(false);
    await vi.waitFor(() => {
      expect(lk.localParticipant.setCameraEnabled).toHaveBeenLastCalledWith(false);
      expect(tracks.some((t) => t.self)).toBe(false);
    });

    // Bar cam-on: the self tile comes back — exactly once, no double-add.
    await stageVideo.setCamEnabled(true);
    await vi.waitFor(() => {
      expect(tracks.filter((t) => t.self)).toHaveLength(1);
    });
    off();
  });

  it("audience mode ignores bar toggles (its token cannot publish)", async () => {
    setMediaPrefs({ micOn: false, camOn: false });
    await stageVideo.joinAsAudience("1", "self");
    lk.localParticipant.setMicrophoneEnabled.mockClear();
    lk.localParticipant.setCameraEnabled.mockClear();
    await stageVideo.setMicEnabled(true);
    await stageVideo.setCamEnabled(true);
    expect(lk.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(lk.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  });
});

/**
 * Confirmed publication state (PRD 25.7): the stage must never read LIVE off an
 * optimistic guess. A confirmed publish reads `live`; a capture/permission
 * failure or a token/connect failure leaves a bounded failure status — NOT live —
 * even though a connection was attempted.
 */
describe("stage publication state is confirmed, never optimistic", () => {
  it("a confirmed voice publish settles to live", async () => {
    const outcome = await stageVideo.goOnAir("1", "self");
    expect(outcome).toEqual({ status: "live" });
    expect(stageVideo.getPublicationStatus()).toBe("live");
  });

  it("going on air while muted is still a confirmed live (muted) broadcast", async () => {
    setMediaPrefs({ micOn: false, camOn: false });
    const outcome = await stageVideo.goOnAir("1", "self");
    expect(outcome).toEqual({ status: "live" });
    expect(stageVideo.getPublicationStatus()).toBe("live");
    // ...but nothing was captured.
    expect(lk.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  });

  it("a denied mic capture never reads as live (goOnAir)", async () => {
    setMediaPrefs({ micOn: true });
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    lk.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(denied);

    const outcome = await stageVideo.goOnAir("1", "self");

    expect(outcome).toEqual({ status: "denied" });
    expect(stageVideo.getPublicationStatus()).toBe("denied");
    expect(stageVideo.getPublicationStatus()).not.toBe("live");
  });

  it("a token/connect failure leaves a failed status, not live (goLive)", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => ({ ok: false, status: 403 }),
    );
    const outcome = await stageVideo.goLive("1", "self");
    expect(outcome).toEqual({ status: "failed" });
    expect(stageVideo.getPublicationStatus()).toBe("failed");
  });

  it("notifies publication-status subscribers on change", async () => {
    const seen: string[] = [];
    const off = stageVideo.onPublicationStatus(() => seen.push(stageVideo.getPublicationStatus()));
    await stageVideo.goOnAir("1", "self");
    expect(seen).toContain("live");
    off();
  });

  it("goLive while already on air with cam-off pref stays live, not a false failure", async () => {
    setMediaPrefs({ micOn: true, camOn: false });
    await stageVideo.goOnAir("1", "self"); // voice on air, no video
    const outcome = await stageVideo.goLive("1", "self");
    expect(outcome).toEqual({ status: "live" });
    expect(stageVideo.getPublicationStatus()).toBe("live");
  });

  it("going off air rests the publication status back to off", async () => {
    await stageVideo.goOnAir("1", "self");
    expect(stageVideo.getPublicationStatus()).toBe("live");
    await stageVideo.goOffAir("1", "self");
    expect(stageVideo.getPublicationStatus()).toBe("off");
  });
});
