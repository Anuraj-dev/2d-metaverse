/**
 * Thin WebAudio transport for the HUD mic-level meter (PRD 20). It attaches an
 * AnalyserNode to the current local mic track and exposes a synchronous `read()`
 * that returns the instantaneous RMS level (0..1). All smoothing/segment decisions
 * live in the pure `game/micMeter` module; this file is glue and stays untested
 * beyond types (no AudioContext in jsdom — it degrades to null there and in e2e's
 * fake-media mode, so the meter simply doesn't render).
 */
import { localAudioTrack } from "./livekit";
import { getStream } from "./localMedia";
import { USE_MOCK } from "../net/auth";

export interface MicAnalyser {
  /** Current RMS level of the mic, 0..1. */
  read(): number;
  /** Tear down the analyser + audio context. */
  stop(): void;
}

function currentTrack(): MediaStreamTrack | null {
  if (USE_MOCK) return getStream()?.getAudioTracks()[0] ?? null;
  return localAudioTrack();
}

type Ctor = typeof AudioContext;

function audioContextCtor(): Ctor | null {
  const w = window as unknown as {
    AudioContext?: Ctor;
    webkitAudioContext?: Ctor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Start an analyser over the current local mic track. Returns null when there is no
 * track or no WebAudio (jsdom / fake media) — the caller then renders no meter.
 */
export function startMicAnalyser(): MicAnalyser | null {
  const track = currentTrack();
  const Ctx = audioContextCtor();
  if (!track || !Ctx) return null;

  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);

  return {
    read() {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = ((buf[i] ?? 128) - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / buf.length);
    },
    stop() {
      source.disconnect();
      void ctx.close();
    },
  };
}
