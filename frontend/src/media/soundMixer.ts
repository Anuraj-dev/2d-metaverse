/**
 * Pure sound-mixer logic — no DOM, no Phaser, no Howler. The single place that
 * owns channel volume math (master over music / sfx / ambient), master mute,
 * speech-driven ducking of the world loops (music + ambient), and the event→sound
 * mapping. The playback glue (`sfx.ts`) and the wiring bridge (`SfxBridge.tsx`)
 * call into this so every gain decision is testable in isolation with playback
 * mocked.
 */
import type { Settings } from "../ui/settings";
import { nextFloat, nextInt, toSeed } from "../game/arcade/prng";

export type Channel = "music" | "sfx" | "ambient" | "arcade";

/** Snapshot of the mixer's inputs, derived from the persisted Settings. */
export interface MixerVolumes {
  master: number; // 0..1
  music: number; // 0..1
  sfx: number; // 0..1
  ambient: number; // 0..1
  arcade: number; // 0..1 — arcade mini-game sfx, its own volume/mute
  muted: boolean; // master mute
  muteSfx: boolean; // silence the sfx channel specifically
  muteArcade: boolean; // silence the arcade channel specifically
}

/**
 * Speech-driven duck: the world loops (music + ambient) drop to this fraction of
 * their gain while any audible peer — or the local player — is actually speaking.
 * Hard duck so proximity voice reads clearly over the bed (tuned by ear).
 */
export const DUCK_FACTOR = 0.12;

/**
 * A remote peer must be at least this audible (0..1 zone/proximity volume) to
 * count toward the duck when speaking — a distant/walled-off speaker never ducks
 * your soundscape. The local player has no proximity volume; self-speech always
 * counts (see `speechActive`).
 */
export const VOICE_THRESHOLD = 0.06;

/**
 * Duck envelope timing. Fast attack (glide down to DUCK_FACTOR the moment speech
 * starts) and a slower, smooth release (recover to full over ~0.7s after the last
 * speech stops) so the mix never pumps or clicks. See `duckStep`.
 */
export const DUCK_ATTACK_MS = 100;
export const DUCK_RELEASE_MS = 700;

export function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** Adapt the persisted Settings into the mixer's input shape. */
export function volumesFromSettings(s: Settings): MixerVolumes {
  return {
    master: s.masterVolume,
    music: s.musicVolume,
    sfx: s.sfxVolume,
    ambient: s.ambientVolume,
    arcade: s.arcadeVolume,
    muted: s.muted,
    muteSfx: s.muteSfx,
    muteArcade: s.muteArcade,
  };
}

/**
 * Final linear gain (0..1) for a channel — the un-ducked base. Master mute forces
 * 0; otherwise the channel volume scales by the master. Ducking is NOT applied
 * here: it is a smoothed, loop-only envelope (`duckStep`) that the glue multiplies
 * onto the two world loops, so one-shot cues never duck.
 */
export function channelGain(v: MixerVolumes, channel: Channel): number {
  if (v.muted) return 0;
  const master = clamp01(v.master);
  if (master <= 0) return 0;
  if (channel === "music") return clamp01(master * clamp01(v.music));
  if (channel === "sfx") {
    if (v.muteSfx) return 0;
    return clamp01(master * clamp01(v.sfx));
  }
  if (channel === "arcade") {
    // Arcade mini-game blips have their own volume + mute so a player can quiet
    // a noisy game without touching world sfx. Still folds under master mute.
    if (v.muteArcade) return 0;
    return clamp01(master * clamp01(v.arcade));
  }
  // ambient
  return clamp01(master * clamp01(v.ambient));
}

/**
 * Speech-driven duck trigger (pure). Voice is active — and the loops should duck —
 * when the local player is speaking, OR any *audible* remote peer is speaking:
 *   ∃ peer p: (zone/proximity volume(p) > threshold) ∧ p is speaking, OR self speaking.
 * `speaking` is the transport's active-speaker identity set (self included when the
 * local mic is active); `volumes` is the per-remote zone volume map (self excluded).
 * A distant/walled-off speaker (volume below threshold) never ducks; a muted local
 * player or no audible peers yields no duck.
 */
export function speechActive(
  speaking: ReadonlySet<string>,
  volumes: Record<string, number>,
  selfId: string,
  threshold = VOICE_THRESHOLD
): boolean {
  if (speaking.has(selfId)) return true;
  for (const id of speaking) {
    if (id === selfId) continue;
    if ((volumes[id] ?? 0) >= threshold) return true;
  }
  return false;
}

// ── Loop lifecycle (where the world loops are allowed to sound) ──────────────

/**
 * World-state inputs that gate the persistent loops — lifecycle, not settings.
 * `outdoors` is derived from the local player's audio zone (OUTDOOR_ZONE vs a
 * room id); `meeting` spans portal-in → portal-out; `musicPlaying` is whether
 * the music scheduler (PRD 21, below) currently has an active track — false
 * during a between-tracks silence gap.
 */
export interface LoopWorld {
  outdoors: boolean;
  meeting: boolean;
  musicPlaying: boolean;
}

/**
 * Base (un-ducked) target gains for the two persistent loops given settings +
 * world state: the outdoor ambience only sounds outdoors (rooms are aurally
 * private — no birdsong through walls), it keeps playing under a music silence
 * gap (PRD 21 — "the outdoor ambience continues underneath"), and both world
 * loops fall silent for the duration of a meeting. The music target is ALSO
 * silent whenever the scheduler is between tracks (`!musicPlaying`), so a gap
 * reads as quiet rather than a paused loop. These are the "scene" targets the
 * glue fades toward at LOOP_FADE_MS; the speech duck (`duckStep`) is a
 * separate, faster envelope the glue multiplies on top of the faded base — it
 * never hard-cuts either.
 */
export function loopTargets(
  v: MixerVolumes,
  world: LoopWorld
): { music: number; ambient: number } {
  return {
    music: world.meeting || !world.musicPlaying ? 0 : channelGain(v, "music"),
    ambient: world.meeting || !world.outdoors ? 0 : channelGain(v, "ambient"),
  };
}

/**
 * Advance the shared duck envelope one tick. The envelope glides in [DUCK_FACTOR,
 * 1] where 1 = no duck and DUCK_FACTOR = fully ducked. It moves toward DUCK_FACTOR
 * fast while voice is active (attack) and back toward 1 slowly once speech stops
 * (release). The glue multiplies this scalar onto both world loops' faded base
 * gains.
 *
 * Speed is measured across the *full duck span* (`1 - DUCK_FACTOR`), NOT the whole
 * 0..1 range: a complete attack takes exactly `attackMs` and a complete release
 * exactly `releaseMs`, independent of how deep DUCK_FACTOR is — so the documented
 * ~100ms attack / ~700ms release is the real traverse time. Lands exactly on the
 * target (no overshoot, no asymptotic crawl).
 */
export function duckStep(
  current: number,
  voiceActive: boolean,
  dtMs: number,
  attackMs = DUCK_ATTACK_MS,
  releaseMs = DUCK_RELEASE_MS
): number {
  const target = voiceActive ? DUCK_FACTOR : 1;
  const fadeMs = voiceActive ? attackMs : releaseMs;
  if (fadeMs <= 0) return target;
  const span = 1 - DUCK_FACTOR; // full duck traverse, open (1) → ducked (DUCK_FACTOR)
  const from = Number.isNaN(current) ? 1 : Math.min(1, Math.max(DUCK_FACTOR, current));
  const maxDelta = (span * Math.max(0, dtMs)) / fadeMs;
  const delta = target - from;
  if (Math.abs(delta) <= maxDelta) return target;
  return from + Math.sign(delta) * maxDelta;
}

/** Full-scale loop fade duration: long enough to feel like a scene change, not a cut. */
export const LOOP_FADE_MS = 700;

/**
 * One linear fade step toward a target gain. Moves at most `dtMs / fadeMs` of
 * full scale per call and lands exactly on the target (no overshoot, no
 * asymptotic crawl), so a fade completes in `fadeMs` regardless of tick rate.
 */
export function fadeStep(
  current: number,
  target: number,
  dtMs: number,
  fadeMs = LOOP_FADE_MS
): number {
  const from = clamp01(current);
  const to = clamp01(target);
  if (fadeMs <= 0) return to;
  const maxDelta = Math.max(0, dtMs) / fadeMs;
  const delta = to - from;
  if (Math.abs(delta) <= maxDelta) return to;
  return clamp01(from + Math.sign(delta) * maxDelta);
}

/** A one-shot sound triggered by a bus/net event. */
export interface SoundCue {
  clip: string;
  channel: Channel;
  /** Notify-class cues obey the `notifySound` toggle instead of the sfx mute. */
  notify?: boolean;
}

/**
 * Event → sound mapping. Game logic stays audio-agnostic: it emits domain events
 * on the bus and this table decides what (if anything) they sound like.
 */
export const EVENT_SOUNDS: Readonly<Record<string, SoundCue>> = {
  sat: { clip: "sit", channel: "sfx" },
  "door-open": { clip: "door_open", channel: "sfx" },
  "door-close": { clip: "door_close", channel: "sfx" },
  "portal-enter": { clip: "portal_in", channel: "sfx" },
  "portal-exit": { clip: "portal_out", channel: "sfx" },
  "meeting-grid-visible": { clip: "meeting_join", channel: "sfx" },
  "meeting-grid-hidden": { clip: "meeting_leave", channel: "sfx" },
  // Arcade cabinets (PRD 11): games stay audio-agnostic and emit these domain
  // events; the mixer decides the blip. Frequent flaps stay silent (no filler).
  // On the dedicated `arcade` channel so players get an independent volume/mute
  // (surfaced in the arcade overlay) without affecting world sfx.
  "open-arcade": { clip: "arcade_start", channel: "arcade" },
  "arcade-point": { clip: "arcade_point", channel: "arcade" },
  "arcade-over": { clip: "arcade_over", channel: "arcade" },
  // Board-game tables (PRD 11 phase 2): reuse the existing sit/arcade cues — the
  // game stays audio-agnostic and emits these domain events; the mixer decides.
  "board-sat": { clip: "sit", channel: "sfx" },
  "board-move": { clip: "arcade_point", channel: "sfx" },
  "board-win": { clip: "arcade_over", channel: "sfx" },
  // Room admin / knock (PRD 14): reuse existing clips — components emit these
  // domain events, the mixer decides the blip. The admin's incoming-knock cue is
  // notify-class so it obeys the notification toggle.
  knocking: { clip: "message", channel: "sfx" },
  "knock-received": { clip: "message", channel: "sfx", notify: true },
  "knock-approved": { clip: "meeting_join", channel: "sfx" },
  "knock-denied": { clip: "leave", channel: "sfx" },
  "admin-promoted": { clip: "portal_in", channel: "sfx" },
  // Stage broadcast (PRD 17): going on / off air. Reuse the meeting join/leave
  // chimes — "you're now broadcasting to the room" reads the same. Audio-agnostic:
  // WorldScene emits the domain events; the mixer picks the clip.
  "stage-on-air": { clip: "meeting_join", channel: "sfx" },
  "stage-off-air": { clip: "meeting_leave", channel: "sfx" },
  // Global control bar (PRD 20): mic/cam toggles. The bar stays audio-agnostic —
  // it emits these domain events and this table decides the blip. Reuse the soft
  // door click as a quiet toggle confirmation (fewer, better clips — no filler).
  "mic-toggle": { clip: "door_close", channel: "sfx" },
  "cam-toggle": { clip: "door_close", channel: "sfx" },
  // Screen share (PRD 23): the control bar emits this domain event on start/stop;
  // reuse the door open/close clicks as a quiet toggle confirmation.
  "screen-share-on": { clip: "door_open", channel: "sfx" },
  "screen-share-off": { clip: "door_close", channel: "sfx" },
};

export function cueForEvent(event: string): SoundCue | null {
  return EVENT_SOUNDS[event] ?? null;
}

/** Footstep cadence state — the timestamp of the last step we played. */
export interface StepState {
  lastStepAt: number;
}

export const STEP_INTERVAL_MS = 300;

/**
 * Decide whether a footstep is due. Pure: given the last-step timestamp, the
 * current time, and whether the player is moving, return the play decision and
 * the next state. No step fires while stationary; steps fire at most every
 * STEP_INTERVAL_MS while moving.
 */
export function footstepDue(
  state: StepState,
  now: number,
  moving: boolean,
  intervalMs = STEP_INTERVAL_MS
): { play: boolean; state: StepState } {
  if (!moving) return { play: false, state };
  if (now - state.lastStepAt >= intervalMs) {
    return { play: true, state: { lastStepAt: now } };
  }
  return { play: false, state };
}

// ── Music scheduler (PRD 21: curated calm pool + Minecraft-style silence gaps) ──
//
// The single looping music bed is replaced by a small pool of curated calm
// tracks: play one to completion, then a randomized multi-minute silence gap
// (only the outdoor ambience keeps sounding under it), then the next — never
// repeating the track that just played. This is a pure, deterministic state
// machine: randomness flows through a serializable `rngSeed` (mulberry32, the
// same convention as the arcade PRNG — never `Math.random`), so replaying a
// seed reproduces the same track order and gap lengths.
//
// The "track" phase is deliberately NOT a countdown: a track's real duration
// lives in its audio file, not in this pure module, so the glue (sfx.ts) tells
// the scheduler a track finished by calling `musicTrackEnded` off the
// `<audio>` element's native `ended` event — exact, no drift, no need to know
// durations here. Only the silence-gap phase is time-driven (`musicSchedulerTick`).

/** The curated calm-music pool (PRD 21). Ids resolve to
 * `public/assets/audio/<id>.ogg` via sfx.ts, same as every other clip. */
export const MUSIC_TRACKS: readonly string[] = ["music_calm_1", "music_calm_2", "music_calm_3"];

/** Silence-gap bounds between tracks — "multi-minute", Minecraft-style, so the
 * music stays a treat rather than a loop players reach to mute. Tunable here. */
export const MUSIC_GAP_MIN_MS = 90_000; // 1.5 min
export const MUSIC_GAP_MAX_MS = 240_000; // 4 min

export type MusicPhase = "track" | "gap";

/** The music scheduler's serializable state. */
export interface MusicSchedulerState {
  phase: MusicPhase;
  /** The track id playing (phase "track") or last played (phase "gap") — kept
   * so the next pick never immediately repeats it. Null only before the very
   * first pick. */
  trackId: string | null;
  /** ms of silence remaining — meaningful only in phase "gap"; unused (0) in
   * phase "track", whose end is signalled by `musicTrackEnded`, not a timer. */
  remainingMs: number;
  /** Carried mulberry32 seed (see game/arcade/prng.ts) — the scheduler's only
   * source of randomness. */
  rngSeed: number;
}

function gapDurationFrom(rand01: number): number {
  return MUSIC_GAP_MIN_MS + rand01 * (MUSIC_GAP_MAX_MS - MUSIC_GAP_MIN_MS);
}

function pickNextTrack(
  tracks: readonly string[],
  exclude: string | null,
  seed: number
): { trackId: string; seed: number } {
  const pool = tracks.length > 1 ? tracks.filter((t) => t !== exclude) : tracks;
  const { value, seed: nextSeed } = nextInt(seed, pool.length);
  const trackId = pool[value];
  if (trackId === undefined) {
    // Unreachable: `value` is drawn in [0, pool.length) and pool.length > 0 is
    // guaranteed by every caller (musicSchedulerTick checks tracks.length,
    // initMusicScheduler's caller owns a non-empty MUSIC_TRACKS). Throwing
    // guard instead of a non-null assertion, per repo convention.
    throw new Error("soundMixer: pickNextTrack drew an out-of-range index (unreachable)");
  }
  return { trackId, seed: nextSeed };
}

/**
 * Start a fresh scheduler in a silence gap — the very first track arrives
 * after one gap, the same cadence as every later cycle (no track blares the
 * instant the app loads).
 */
export function initMusicScheduler(rngSeed: number): MusicSchedulerState {
  const { value, seed } = nextFloat(toSeed(rngSeed));
  return { phase: "gap", trackId: null, remainingMs: gapDurationFrom(value), rngSeed: seed };
}

/**
 * Advance the scheduler by `dtMs` of wall-clock time. Only the silence-gap
 * phase is time-driven: it counts down and, on reaching zero, picks the next
 * track (never an immediate repeat when 2+ tracks exist) and switches to
 * phase "track". The "track" phase itself does not advance here — see
 * `musicTrackEnded`.
 *
 * `paused` freezes the clock entirely — meetings silence the music
 * (`loopTargets`) but must not "spend" gap time while a meeting is on
 * (PRD 21: music behaviour in meetings is unchanged from before, and resumes
 * exactly where it left off after).
 */
export function musicSchedulerTick(
  state: MusicSchedulerState,
  dtMs: number,
  paused: boolean,
  tracks: readonly string[] = MUSIC_TRACKS
): MusicSchedulerState {
  if (paused || state.phase !== "gap" || dtMs <= 0 || tracks.length === 0) return state;
  const remaining = state.remainingMs - dtMs;
  if (remaining > 0) return { ...state, remainingMs: remaining };
  const picked = pickNextTrack(tracks, state.trackId, state.rngSeed);
  return { phase: "track", trackId: picked.trackId, remainingMs: 0, rngSeed: picked.seed };
}

/**
 * The glue calls this when the currently-playing track's `<audio>` element
 * fires its native `ended` event — "play one track to completion" (PRD 21).
 * Starts the next silence gap, its duration drawn from the scheduler's seeded
 * PRNG. A no-op outside phase "track" (defensive — the glue should only ever
 * call this while a track is actually playing).
 */
export function musicTrackEnded(state: MusicSchedulerState): MusicSchedulerState {
  if (state.phase !== "track") return state;
  const { value, seed } = nextFloat(state.rngSeed);
  return { phase: "gap", trackId: state.trackId, remainingMs: gapDurationFrom(value), rngSeed: seed };
}
