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
    getTrackPublications: () => [],
  };
  class FakeRoom {
    localParticipant = localParticipant;
    on() {
      return this;
    }
    connect = connect;
    disconnect = disconnect;
  }
  return { connect, disconnect, localParticipant, FakeRoom };
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
