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
  it.each([{ micOn: true }, { micOn: false }])(
    "goOnAir applies micOn=$micOn from prefs",
    async ({ micOn }) => {
      setMediaPrefs({ micOn });
      await stageVideo.goOnAir("1", "self");
      expect(lk.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(micOn);
      // Voice broadcast never touches the camera.
      expect(lk.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
    }
  );

  it("re-going on air after an off-air interlude still respects a mute set meanwhile", async () => {
    await stageVideo.goOnAir("1", "self");
    setMediaPrefs({ micOn: false });
    await stageVideo.goOffAir("1", "self");
    lk.localParticipant.setMicrophoneEnabled.mockClear();
    await stageVideo.goOnAir("1", "self");
    expect(lk.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
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
    stageVideo.setMicEnabled(false);
    expect(lk.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
  });

  it("turning the cam on from the bar while live publishes and surfaces the self tile", async () => {
    setMediaPrefs({ camOn: false });
    await stageVideo.goLive("1", "self"); // live, but video-muted per pref
    let tracks: RoomTrack[] = [];
    const off = stageVideo.onTracks((t) => (tracks = t));
    setMediaPrefs({ camOn: true });
    stageVideo.setCamEnabled(true);
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
    stageVideo.setCamEnabled(false);
    await vi.waitFor(() => {
      expect(lk.localParticipant.setCameraEnabled).toHaveBeenLastCalledWith(false);
      expect(tracks.some((t) => t.self)).toBe(false);
    });

    // Bar cam-on: the self tile comes back — exactly once, no double-add.
    stageVideo.setCamEnabled(true);
    await vi.waitFor(() => {
      expect(tracks.filter((t) => t.self)).toHaveLength(1);
    });
    off();
  });

  it("audience mode ignores bar toggles (its token cannot publish)", async () => {
    await stageVideo.joinAsAudience("1", "self");
    lk.localParticipant.setMicrophoneEnabled.mockClear();
    lk.localParticipant.setCameraEnabled.mockClear();
    stageVideo.setMicEnabled(true);
    stageVideo.setCamEnabled(true);
    expect(lk.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(lk.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  });
});
