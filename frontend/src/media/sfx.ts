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
  clamp01,
  DUCK_FACTOR,
  duckStep,
  fadeStep,
  initMusicScheduler,
  loopTargets,
  musicSchedulerTick,
  musicTrackEnded,
  MUSIC_TRACKS,
  volumesFromSettings,
  type Channel,
  type MusicSchedulerState,
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
  "arcade_start",
  "arcade_point",
  "arcade_over",
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
  // One-shot cues never duck (sfx untouched; the duck is a loop-only envelope).
  return channelGain(volumesFromSettings(getSettings()), channel);
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

// ── Loops (curated music pool + outdoor ambient) ─────────────────────────────
//
// The loops are LIFECYCLE-AWARE: the outdoor ambience only sounds while the
// local player is outdoors, and both world loops fall silent across a meeting
// (portal-in → portal-out). Two independent smoothers drive each loop and are
// multiplied to the applied volume:
//   • a slow BASE fade (soundMixer.loopTargets / fadeStep, ~700ms) for scene-scale
//     changes — zone crossings, meetings, silence gaps, slider/mute moves;
//   • a shared speech DUCK envelope (soundMixer.duckStep) with a fast attack and a
//     ~700ms release, dropping BOTH loops to DUCK_FACTOR while a peer/self speaks.
// Nothing hard-cuts. A loop element is paused once its applied gain reaches
// silence with a silent base target, and resumed when it becomes audible again.
//
// Music (PRD 21) is a small curated pool driven by the pure scheduler in
// soundMixer.ts: `musicLoop` is NOT set to loop — it plays one track to
// completion (the native `ended` event advances the scheduler into a silence
// gap), then the gap timer (ticked here, frozen during a meeting) counts down
// to the next track. `ensureTrackLoaded` swaps the element's `src` exactly
// when the scheduler hands it a new track id.

let voiceActive = false;
let outdoors = true; // players spawn in the plaza (outdoor zone)
let meeting = false;
let musicLoop: HTMLAudioElement | null = null;
let ambientLoop: HTMLAudioElement | null = null;
// Smoother state: the un-ducked base gains (fade slowly) and the shared duck
// envelope (1 = open, DUCK_FACTOR = fully ducked; fast attack / slow release).
let musicBase = 0;
let ambientBase = 0;
let duckEnv = 1;
let started = false;
let unbindSettings: (() => void) | null = null;
let fadeTimer: ReturnType<typeof setInterval> | null = null;
let lastFadeTick = 0;

// The music scheduler's own state + which track id is currently loaded into
// `musicLoop.src` (so a repeated tick with the same track id is a no-op).
let scheduler: MusicSchedulerState = initMusicScheduler(Date.now());
let loadedTrackId: string | null = null;

const FADE_TICK_MS = 50;

function makeLoop(clip: string): HTMLAudioElement {
  const a = new Audio(`${BASE}/${clip}.ogg`);
  a.loop = true;
  a.preload = "auto";
  return a;
}

/** The music element is never `loop`d — the scheduler decides what plays next. */
function makeMusicElement(): HTMLAudioElement {
  const a = new Audio();
  a.preload = "auto";
  a.addEventListener("ended", handleTrackEnded);
  return a;
}

/** Swap the music element's `src` to the scheduler's current track, if it changed. */
function ensureTrackLoaded(): void {
  if (!musicLoop || scheduler.phase !== "track" || scheduler.trackId === null) return;
  if (loadedTrackId === scheduler.trackId) return;
  loadedTrackId = scheduler.trackId;
  musicLoop.src = `${BASE}/${scheduler.trackId}.ogg`;
  musicLoop.load();
}

/** The current track finished playing to completion — advance to a silence gap. */
function handleTrackEnded(): void {
  scheduler = musicTrackEnded(scheduler);
  refreshLoops();
}

function baseTargets(): { music: number; ambient: number } {
  return loopTargets(volumesFromSettings(getSettings()), {
    outdoors,
    meeting,
    musicPlaying: scheduler.phase === "track",
  });
}

/** Apply an already-computed gain to a loop; pause at silence, resume when audible. */
function applyLoopGain(loop: HTMLAudioElement, gain: number, baseTarget: number): void {
  loop.volume = clamp01(gain);
  if (loop.volume <= 0 && baseTarget <= 0) {
    if (!loop.paused) loop.pause();
  } else if (loop.paused) {
    void loop.play().catch(() => {
      /* autoplay blocked until first gesture — ignore */
    });
  }
}

function fadeTick(): void {
  const now = performance.now();
  const dt = now - lastFadeTick;
  lastFadeTick = now;
  // Advance the silence-gap countdown (frozen during a meeting); swap in a new
  // track's src the instant the scheduler hands one over.
  scheduler = musicSchedulerTick(scheduler, dt, meeting, MUSIC_TRACKS);
  ensureTrackLoaded();
  const t = baseTargets();
  musicBase = fadeStep(musicBase, t.music, dt);
  ambientBase = fadeStep(ambientBase, t.ambient, dt);
  duckEnv = duckStep(duckEnv, voiceActive, dt);
  if (musicLoop) applyLoopGain(musicLoop, musicBase * duckEnv, t.music);
  if (ambientLoop) applyLoopGain(ambientLoop, ambientBase * duckEnv, t.ambient);
  // Keep ticking until every smoother has settled on its target: the base fades
  // reach their loop targets AND the duck envelope reaches its rest/ducked value.
  // A pending (unpaused) silence gap must keep the ticker alive even once the
  // envelopes settle at 0 — otherwise the gap's countdown would freeze forever
  // and the next track would never arrive.
  const duckTarget = voiceActive ? DUCK_FACTOR : 1;
  const settled =
    musicBase === t.music && ambientBase === t.ambient && duckEnv === duckTarget;
  const gapPending = scheduler.phase === "gap" && !meeting;
  if (settled && !gapPending && fadeTimer !== null) {
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

/** Update the speech-duck state when voice starts/stops, then re-run the envelope. */
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
    musicLoop = makeMusicElement();
    ambientLoop = makeLoop("ambient_outdoor");
    musicLoop.volume = 0;
    ambientLoop.volume = 0;
    musicBase = 0;
    ambientBase = 0;
    duckEnv = 1;
    unbindSettings = subscribeSettings(refreshLoops);
    // The scheduler starts in a silence gap (no track blares on load), so
    // there is usually nothing to load/play yet — ensureTrackLoaded is still
    // called defensively in case a resumed/hot-reloaded scheduler is already
    // mid-track.
    ensureTrackLoaded();
    if (loadedTrackId !== null) void musicLoop.play().catch(() => {});
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
  musicLoop?.removeEventListener("ended", handleTrackEnded);
  unbindSettings?.();
  unbindSettings = null;
  musicLoop = null;
  ambientLoop = null;
  // A fresh element on the next startLoops() has no src loaded yet — forget
  // what was loaded into the discarded element so ensureTrackLoaded reloads it.
  loadedTrackId = null;
  started = false;
}
