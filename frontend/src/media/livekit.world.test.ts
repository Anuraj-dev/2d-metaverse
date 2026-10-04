import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setMediaPrefs } from "./mediaPrefs";
import { bus } from "../game/eventBus";

const lk = vi.hoisted(() => {
  const connect = vi.fn(async () => {});
  const disconnect = vi.fn(async () => {});
  const localParticipant = {
    setMicrophoneEnabled: vi.fn(async () => {}),
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
  return { localParticipant, FakeRoom, connect, disconnect };
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

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

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
  lk.connect.mockReset().mockResolvedValue(undefined);
  lk.disconnect.mockReset().mockResolvedValue(undefined);
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

  it("does not reconnect or duplicate volume updates when started twice", async () => {
    await worldAudio.start("1", "self");
    await worldAudio.start("1", "self");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shares a pending start instead of opening concurrent rooms", async () => {
    const gate = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(gate.promise);
    const first = worldAudio.start("1", "self");
    const second = worldAudio.start("1", "self");
    gate.resolve(new Response(JSON.stringify({ livekitToken: "tok", url: "wss://lk.test" })));
    await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(lk.connect).toHaveBeenCalledTimes(1);
  });

  it("never opens or captures from a token response that arrives after stop", async () => {
    setMediaPrefs({ micOn: true });
    const gate = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(gate.promise);
    const pending = worldAudio.start("1", "self");
    await worldAudio.stop();
    gate.resolve(new Response(JSON.stringify({ livekitToken: "tok", url: "wss://lk.test" })));
    await pending;
    expect(lk.connect).not.toHaveBeenCalled();
    expect(lk.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    await worldAudio.start("1", "self");
    expect(lk.connect).toHaveBeenCalledTimes(1);
  });

  it("does not let an obsolete start failure clear a newer room", async () => {
    const gate = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(gate.promise);
    const obsolete = worldAudio.start("1", "self");
    await worldAudio.stop();
    await worldAudio.start("1", "self");
    gate.reject(new Error("old request failed"));
    await obsolete;
    await worldAudio.setMicEnabled(false);
    expect(lk.disconnect).not.toHaveBeenCalled();
    expect(lk.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
  });

  it("disconnects a room whose connect finishes after stop without capturing", async () => {
    setMediaPrefs({ micOn: true });
    const gate = deferred<void>();
    const connecting = deferred<void>();
    lk.connect.mockImplementationOnce(() => {
      connecting.resolve();
      return gate.promise;
    });
    const pending = worldAudio.start("1", "self");
    await connecting.promise;
    await worldAudio.stop();
    gate.resolve();
    await pending;
    expect(lk.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(lk.disconnect).toHaveBeenCalledTimes(2);
  });

  it("releases a failed world connection so the next start can retry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    lk.connect.mockRejectedValueOnce(new Error("offline"));
    try {
      await worldAudio.start("1", "self");
      expect(lk.disconnect).toHaveBeenCalledTimes(1);
      await worldAudio.start("1", "self");
      expect(lk.connect).toHaveBeenCalledTimes(2);
      expect(lk.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("replaces the positions listener when retrying after a failed token request", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const updates = vi.fn();
    const off = bus.on("audio-volumes", updates);
    try {
      vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
      await worldAudio.start("1", "self");
      await worldAudio.start("1", "self");
      bus.emit("positions", { players: [{ id: "self", self: true, x: 0, y: 0 }] });
      expect(updates).toHaveBeenCalledTimes(1);
      await worldAudio.stop();
      bus.emit("positions", { players: [{ id: "self", self: true, x: 0, y: 0 }] });
      expect(updates).toHaveBeenCalledTimes(1);
    } finally {
      off();
      warn.mockRestore();
    }
  });
});
