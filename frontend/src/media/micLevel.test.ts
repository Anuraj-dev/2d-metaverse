import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the track seams: the analyser must follow whatever `localAudioTrack()`
// currently returns (the room/world publish fan-out), re-resolved per read.
vi.mock("./livekit", () => ({ localAudioTrack: vi.fn(() => null) }));
vi.mock("./localMedia", () => ({ getStream: () => null }));
vi.mock("../net/auth", () => ({ USE_MOCK: false }));

import { localAudioTrack } from "./livekit";
import { startMicAnalyser } from "./micLevel";

const trackMock = vi.mocked(localAudioTrack);

/* ------------------------------ fakes ---------------------------------- */

class FakeTrack {
  kind = "audio";
  readyState: MediaStreamTrackState = "live";
  private listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, cb: () => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(cb);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, cb: () => void) {
    this.listeners.get(type)?.delete(cb);
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  /** Simulate the underlying MediaStreamTrack dying in place. */
  end() {
    this.readyState = "ended";
    for (const cb of [...(this.listeners.get("ended") ?? [])]) cb();
  }
  asTrack(): MediaStreamTrack {
    return this as unknown as MediaStreamTrack;
  }
}

class FakeMediaStream {
  tracks: unknown[];
  constructor(tracks: unknown[]) {
    this.tracks = tracks;
  }
}

class FakeSourceNode {
  connected = false;
  stream: FakeMediaStream;
  constructor(stream: FakeMediaStream) {
    this.stream = stream;
  }
  connect() {
    this.connected = true;
  }
  disconnect() {
    this.connected = false;
  }
}

class FakeAnalyser {
  fftSize = 2048;
  /** How many times the audio graph was actually sampled. */
  reads = 0;
  /** Byte value every sample returns (128 = silence, 192 = half amplitude). */
  sampleByte = 128;
  getByteTimeDomainData(buf: Uint8Array) {
    this.reads++;
    buf.fill(this.sampleByte);
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  sources: FakeSourceNode[] = [];
  analyser = new FakeAnalyser();
  closed = false;
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createMediaStreamSource(stream: FakeMediaStream): FakeSourceNode {
    const node = new FakeSourceNode(stream);
    this.sources.push(node);
    return node;
  }
  createAnalyser(): FakeAnalyser {
    return this.analyser;
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

function lastCtx(): FakeAudioContext {
  const ctx = FakeAudioContext.instances.at(-1);
  if (!ctx) throw new Error("no FakeAudioContext was constructed");
  return ctx;
}

beforeEach(() => {
  FakeAudioContext.instances = [];
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("MediaStream", FakeMediaStream);
  trackMock.mockReset();
  trackMock.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------ tests ----------------------------------- */

describe("startMicAnalyser", () => {
  it("returns null when WebAudio is unavailable", () => {
    vi.unstubAllGlobals();
    expect(startMicAnalyser()).toBeNull();
  });

  it("attaches the current track and reads its RMS level", () => {
    const track = new FakeTrack();
    trackMock.mockReturnValue(track.asTrack());
    const meter = startMicAnalyser();
    expect(meter).not.toBeNull();
    const ctx = lastCtx();
    expect(ctx.sources).toHaveLength(1);
    expect((ctx.sources[0]?.stream.tracks ?? [])[0]).toBe(track);
    ctx.analyser.sampleByte = 192; // |192-128|/128 = 0.5 amplitude everywhere
    expect(meter?.read()).toBeCloseTo(0.5);
  });

  it("starts without a track and attaches once one is published", () => {
    const meter = startMicAnalyser();
    const ctx = lastCtx();
    expect(meter?.read()).toBe(0);
    expect(ctx.sources).toHaveLength(0);

    const track = new FakeTrack();
    trackMock.mockReturnValue(track.asTrack());
    meter?.read();
    expect(ctx.sources).toHaveLength(1);
    expect(track.listenerCount("ended")).toBe(1);
  });

  it("reattaches to the new track when the published track switches", () => {
    const world = new FakeTrack();
    trackMock.mockReturnValue(world.asTrack());
    const meter = startMicAnalyser();
    const ctx = lastCtx();
    meter?.read();
    expect(ctx.sources).toHaveLength(1);

    // Walk → room handoff: a different local track is now the published one.
    const room = new FakeTrack();
    trackMock.mockReturnValue(room.asTrack());
    meter?.read();
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[0]?.connected).toBe(false); // old source released
    expect(ctx.sources[1]?.connected).toBe(true);
    expect((ctx.sources[1]?.stream.tracks ?? [])[0]).toBe(room);
    expect(world.listenerCount("ended")).toBe(0); // old listener removed
    expect(room.listenerCount("ended")).toBe(1);
  });

  it("survives the null-track gap of a room handoff and re-arms after it", () => {
    const world = new FakeTrack();
    trackMock.mockReturnValue(world.asTrack());
    const meter = startMicAnalyser();
    const ctx = lastCtx();

    // World audio torn down, room still connecting: no track for a while.
    world.end();
    trackMock.mockReturnValue(null);
    expect(meter?.read()).toBe(0);
    expect(ctx.sources[0]?.connected).toBe(false);

    // Room connects and publishes: the meter picks the new track up.
    const room = new FakeTrack();
    trackMock.mockReturnValue(room.asTrack());
    meter?.read();
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[1]?.connected).toBe(true);
  });

  it("stops sampling the audio graph when the track ends unreplaced", () => {
    const track = new FakeTrack();
    trackMock.mockReturnValue(track.asTrack());
    const meter = startMicAnalyser();
    const ctx = lastCtx();
    ctx.analyser.sampleByte = 192;
    expect(meter?.read()).toBeCloseTo(0.5);
    const readsWhileLive = ctx.analyser.reads;

    // The track dies in place; localAudioTrack still returns the dead track
    // (publication not yet cleaned up) — the readyState guard must reject it.
    track.end();
    expect(ctx.sources[0]?.connected).toBe(false); // released by `ended`
    expect(track.listenerCount("ended")).toBe(0);
    expect(meter?.read()).toBe(0);
    expect(meter?.read()).toBe(0);
    expect(ctx.analyser.reads).toBe(readsWhileLive); // stale input never sampled
  });

  it("stop() releases the source, closes the context and goes inert", () => {
    const track = new FakeTrack();
    trackMock.mockReturnValue(track.asTrack());
    const meter = startMicAnalyser();
    const ctx = lastCtx();

    meter?.stop();
    expect(ctx.closed).toBe(true);
    expect(ctx.sources[0]?.connected).toBe(false);
    expect(track.listenerCount("ended")).toBe(0);
    // A straggling read (rAF racing unmount) must not reattach to the closed ctx.
    expect(meter?.read()).toBe(0);
    expect(ctx.sources).toHaveLength(1);
  });
});
