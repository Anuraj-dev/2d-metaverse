/**
 * Sound engine glue over HTMLAudio. Thin on purpose: every gain/mute/duck/event
 * decision lives in the pure `soundMixer.ts`; this file just loads clips, plays
 * them at the mixer-computed gain, owns the music + ambient loops, and handles
 * the browser autoplay-unlock (audio stays silent until the first user gesture,
 * with play() rejections swallowed so telemetry/gameplay never break).
 *
 * Assets are Ogg Vorbis under public/assets/audio (see scripts/curate_audio.py and
 * ATTRIBUTIONS.md). Pure decision logic → soundMixer.ts; wiring → SoundBridge.
 */
import { getSettings, subscribeSettings } from "../ui/settings";
import {
  channelGain,
  fadeStep,
  loopTargets,
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
//
// The loops are LIFECYCLE-AWARE: the outdoor ambience only sounds while the
// local player is outdoors, and both world loops fall silent across a meeting
// (portal-in → portal-out). Every gain change — duck, zone change, meeting,
// slider — FADES toward the pure-mixer target (soundMixer.loopTargets /
// fadeStep); nothing hard-cuts. A loop element is paused once its fade reaches
// silence and resumed when its target rises again.

let voiceActive = false;
let outdoors = true; // players spawn in the plaza (outdoor zone)
let meeting = false;
let musicLoop: HTMLAudioElement | null = null;
let ambientLoop: HTMLAudioElement | null = null;
let started = false;
let unbindSettings: (() => void) | null = null;
let fadeTimer: ReturnType<typeof setInterval> | null = null;
let lastFadeTick = 0;

const FADE_TICK_MS = 50;

function makeLoop(clip: string): HTMLAudioElement {
  const a = new Audio(`${BASE}/${clip}.ogg`);
  a.loop = true;
  a.preload = "auto";
  return a;
}

function currentTargets(): { music: number; ambient: number } {
  return loopTargets(volumesFromSettings(getSettings()), {
    outdoors,
    meeting,
    voiceActive,
  });
}

/** Step one loop toward its target gain; pause at silence, resume when audible. */
function fadeLoopToward(loop: HTMLAudioElement, target: number, dt: number): boolean {
  const next = fadeStep(loop.volume, target, dt);
  loop.volume = next;
  if (next <= 0 && target <= 0) {
    if (!loop.paused) loop.pause();
  } else if (loop.paused) {
    void loop.play().catch(() => {
      /* autoplay blocked until first gesture — ignore */
    });
  }
  return next === target;
}

function fadeTick(): void {
  const now = performance.now();
  const dt = now - lastFadeTick;
  lastFadeTick = now;
  const t = currentTargets();
  const musicDone = musicLoop ? fadeLoopToward(musicLoop, t.music, dt) : true;
  const ambientDone = ambientLoop ? fadeLoopToward(ambientLoop, t.ambient, dt) : true;
  if (musicDone && ambientDone && fadeTimer !== null) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
}

/** (Re)start the fade ticker so the loops converge on the current targets. */
function refreshLoops(): void {
  if (!started || fadeTimer !== null) return;
  lastFadeTick = performance.now();
  fadeTimer = setInterval(fadeTick, FADE_TICK_MS);
}

/** Update the duck state when nearby voice starts/stops, then re-fade ambient. */
export function setVoiceActive(active: boolean): void {
  if (active === voiceActive) return;
  voiceActive = active;
  refreshLoops();
}

/** Local player crossed an audio-zone boundary (outdoors ⇄ inside a room). */
export function setOutdoors(value: boolean): void {
  if (value === outdoors) return;
  outdoors = value;
  refreshLoops();
}

/** Meeting lifecycle: silence the world loops from portal-in to portal-out. */
export function setMeetingActive(value: boolean): void {
  if (value === meeting) return;
  meeting = value;
  refreshLoops();
}

/**
 * Start the persistent loops. Must be called from (or after) a user gesture so
 * the browser lets them play. Safe to call repeatedly — only the first starts
 * playback (fading in from silence); later calls just re-converge the gains.
 * A settings subscription keeps loop gains in sync with slider/mute changes.
 */
export function startLoops(): void {
  if (!started) {
    started = true;
    musicLoop = makeLoop("music_bed");
    ambientLoop = makeLoop("ambient_outdoor");
    musicLoop.volume = 0;
    ambientLoop.volume = 0;
    unbindSettings = subscribeSettings(refreshLoops);
    void musicLoop.play().catch(() => {});
    void ambientLoop.play().catch(() => {});
  }
  refreshLoops();
}

/** Tear down loops, ticker + subscription (used on unmount). */
export function stopLoops(): void {
  if (fadeTimer !== null) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
  musicLoop?.pause();
  ambientLoop?.pause();
  unbindSettings?.();
  unbindSettings = null;
  musicLoop = null;
  ambientLoop = null;
  started = false;
}
