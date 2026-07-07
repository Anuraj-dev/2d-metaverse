/**
 * Thin WebAudio transport for the HUD mic-level meter (PRD 20). It keeps an
 * AnalyserNode attached to whichever local mic track is CURRENTLY published —
 * the private-room track while seated, else the world proximity track — and
 * exposes a synchronous `read()` that returns the instantaneous RMS level
 * (0..1). Every read re-resolves the active track, so a walk-to-room handoff
 * reattaches the analyser to the newly published track (including across the
 * gap where world audio is already down and the room is still connecting), and
 * a track that dies in place (`ended`) releases its source node instead of
 * being polled forever. All smoothing/segment decisions live in the pure
 * `game/micMeter` module; this file is lifecycle glue over WebAudio, tested
 * with the track + AudioContext seams mocked (`micLevel.test.ts`). It degrades
 * to null where WebAudio is absent (jsdom, e2e fake-media) — the meter then
 * simply doesn't animate.
 */
import { localAudioTrack } from "./livekit";
import { getStream } from "./localMedia";
import { USE_MOCK } from "../net/auth";

export interface MicAnalyser {
  /** Current RMS level of the mic, 0..1 (0 while no live track is published). */
  read(): number;
  /** Tear down the analyser + audio context. */
  stop(): void;
}

function currentTrack(): MediaStreamTrack | null {
  const track = USE_MOCK
    ? (getStream()?.getAudioTracks()[0] ?? null)
    : localAudioTrack();
  // A track that already ended is stale input (device lost, room torn down) —
  // treat it as absent so the meter detaches rather than reading a dead source.
  return track && track.readyState !== "ended" ? track : null;
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
 * Start an analyser that follows the local mic track. Returns null only when
 * WebAudio is unavailable (jsdom / fake media) — the caller then renders no
 * meter. With WebAudio present it starts even if no track is published yet
 * (e.g. LiveKit still connecting) and attaches as soon as one appears.
 */
export function startMicAnalyser(): MicAnalyser | null {
  const Ctx = audioContextCtor();
  if (!Ctx) return null;

  const ctx = new Ctx();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  const buf = new Uint8Array(analyser.fftSize);

  let source: MediaStreamAudioSourceNode | null = null;
  let attached: MediaStreamTrack | null = null;
  let stopped = false;

  const detach = () => {
    attached?.removeEventListener("ended", onEnded);
    source?.disconnect();
    source = null;
    attached = null;
  };
  // The attached track dying must release the audio graph immediately, not
  // wait for the next read — otherwise a dead input is held until unmount.
  const onEnded = () => detach();

  /** Re-point the source node at whichever local mic track is live right now. */
  const sync = () => {
    const track = stopped ? null : currentTrack();
    if (track === attached) return;
    detach();
    if (!track) return;
    source = ctx.createMediaStreamSource(new MediaStream([track]));
    source.connect(analyser);
    track.addEventListener("ended", onEnded);
    attached = track;
  };
  sync();

  return {
    read() {
      sync();
      if (!attached) return 0;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = ((buf[i] ?? 128) - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / buf.length);
    },
    stop() {
      stopped = true;
      detach();
      void ctx.close();
    },
  };
}
