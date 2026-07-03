/**
 * Sound engine glue over HTMLAudio. Thin on purpose: every gain/mute/duck/event
 * decision lives in the pure `soundMixer.ts`; this file just loads clips, plays
 * them at the mixer-computed gain, owns the music + ambient loops, and handles
 * the browser autoplay-unlock (audio stays silent until the first user gesture,
 * with play() rejections swallowed so telemetry/gameplay never break).
 *
 * Assets are Ogg Vorbis under public/assets/audio (see scripts/gen_audio.py and
 * ATTRIBUTIONS.md). Pure decision logic → soundMixer.ts; wiring → SoundBridge.
 */
import { getSettings, subscribeSettings } from "../ui/settings";
import {
  channelGain,
  volumesFromSettings,
  type Channel,
} from "./soundMixer";

const BASE = "/assets/audio";

/** One-shot clips (channel is decided by the caller / event mapping). */
const CLIPS = [
  "message",
  "join",
  "leave",
  "sit",
  "footstep",
  "door_open",
  "door_close",
  "portal_in",
  "portal_out",
  "meeting_join",
  "meeting_leave",
] as const;

/** Legacy one-shot names still referenced by ChatToast / older callers. */
export type SfxName = "message" | "join" | "leave" | "sit";

const cache = new Map<string, HTMLAudioElement>();

function el(clip: string): HTMLAudioElement {
  let a = cache.get(clip);
  if (!a) {
    a = new Audio(`${BASE}/${clip}.ogg`);
    a.preload = "auto";
    cache.set(clip, a);
  }
  return a;
}

function gainFor(channel: Channel): number {
  return channelGain(volumesFromSettings(getSettings()), channel, {
    voiceActive,
  });
}

/** Preload every one-shot clip so the first play is instant. Idempotent. */
export function preloadSfx(): void {
  for (const c of CLIPS) el(c).load();
}

/**
 * Play a one-shot clip on a channel. `notify` clips obey the `notifySound`
 * toggle; everything else obeys the channel gain (which folds in master mute +
 * per-channel mute). Cloned per call so rapid repeats overlap.
 */
export function playCue(
  clip: string,
  channel: Channel = "sfx",
  opts: { notify?: boolean } = {}
): void {
  if (opts.notify && !getSettings().notifySound) return;
  const vol = gainFor(channel);
  if (vol <= 0) return;
  const node = el(clip).cloneNode(true) as HTMLAudioElement;
  node.volume = vol;
  void node.play().catch(() => {
    /* autoplay blocked until first gesture — ignore */
  });
}

/** Back-compat shim: legacy sfx names all live on the sfx channel. */
export function playSfx(name: SfxName, opts: { notify?: boolean } = {}): void {
  playCue(name, "sfx", opts);
}

// ── Loops (music bed + outdoor ambient) ──────────────────────────────────────

let voiceActive = false;
let musicLoop: HTMLAudioElement | null = null;
let ambientLoop: HTMLAudioElement | null = null;
let started = false;
let unbindSettings: (() => void) | null = null;

function makeLoop(clip: string): HTMLAudioElement {
  const a = new Audio(`${BASE}/${clip}.ogg`);
  a.loop = true;
  a.preload = "auto";
  return a;
}

function refreshLoops(): void {
  if (musicLoop) musicLoop.volume = gainFor("music");
  if (ambientLoop) ambientLoop.volume = gainFor("ambient");
}

/** Update the duck state when nearby voice starts/stops, then re-gain ambient. */
export function setVoiceActive(active: boolean): void {
  if (active === voiceActive) return;
  voiceActive = active;
  refreshLoops();
}

/**
 * Start the persistent loops. Must be called from (or after) a user gesture so
 * the browser lets them play. Safe to call repeatedly — only the first starts
 * playback; later calls just re-gain. A settings subscription keeps loop gains
 * in sync with slider/mute changes.
 */
export function startLoops(): void {
  if (!started) {
    started = true;
    musicLoop = makeLoop("music_bed");
    ambientLoop = makeLoop("ambient_outdoor");
    unbindSettings = subscribeSettings(refreshLoops);
  }
  refreshLoops();
  void musicLoop?.play().catch(() => {});
  void ambientLoop?.play().catch(() => {});
}

/** Tear down loops + subscription (used on unmount). */
export function stopLoops(): void {
  musicLoop?.pause();
  ambientLoop?.pause();
  unbindSettings?.();
  unbindSettings = null;
  musicLoop = null;
  ambientLoop = null;
  started = false;
}
