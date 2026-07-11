import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setMediaPrefs } from "./mediaPrefs";

const lk = vi.hoisted(() => {
  const localParticipant = {
    setMicrophoneEnabled: vi.fn(async () => {}),
    getTrackPublications: () => [],
  };
  class FakeRoom {
    localParticipant = localParticipant;
    on() {
      return this;
    }
    async connect() {}
    async disconnect() {}
  }
  return { localParticipant, FakeRoom };
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

import { worldAudio } from "./livekit";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ livekitToken: "tok", url: "wss://lk.test" }),
    })),
  );
  setMediaPrefs({ micOn: false, camOn: false });
  lk.localParticipant.setMicrophoneEnabled.mockClear();
});

afterEach(async () => {
  await worldAudio.stop();
  vi.unstubAllGlobals();
});

describe("world audio consent", () => {
  it("connects receive-only without requesting a microphone on cold start", async () => {
    await worldAudio.start("1", "self");

    expect(lk.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  });

  it("replays an explicit microphone enable on the next world connection", async () => {
    setMediaPrefs({ micOn: true });

    await worldAudio.start("1", "self");

    expect(lk.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
  });
});
