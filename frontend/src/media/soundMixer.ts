/**
 * Pure sound-mixer logic — no DOM, no Phaser, no Howler. The single place that
 * owns channel volume math (master over music / sfx / ambient), master mute,
 * speech-driven ducking of the world loops (music + ambient), and the event→sound
 * mapping. The playback glue (`sfx.ts`) and the wiring bridge (`SfxBridge.tsx`)
 * call into this so every gain decision is testable in isolation with playback
 * mocked.
 */
import type { Settings } from "../ui/settings";

export type Channel = "music" | "sfx" | "ambient";

/** Snapshot of the mixer's inputs, derived from the persisted Settings. */
export interface MixerVolumes {
  master: number; // 0..1
  music: number; // 0..1
  sfx: number; // 0..1
  ambient: number; // 0..1
  muted: boolean; // master mute
  muteSfx: boolean; // silence the sfx channel specifically
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
    muted: s.muted,
    muteSfx: s.muteSfx,
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
 * room id); `meeting` spans portal-in → portal-out.
 */
export interface LoopWorld {
  outdoors: boolean;
  meeting: boolean;
}

/**
 * Base (un-ducked) target gains for the two persistent loops given settings +
 * world state: the outdoor ambience only sounds outdoors (rooms are aurally
 * private — no birdsong through walls), and both world loops fall silent for the
 * duration of a meeting. These are the "scene" targets the glue fades toward at
 * LOOP_FADE_MS; the speech duck (`duckStep`) is a separate, faster envelope the
 * glue multiplies on top of the faded base — it never hard-cuts either.
 */
export function loopTargets(
  v: MixerVolumes,
  world: LoopWorld
): { music: number; ambient: number } {
  return {
    music: world.meeting ? 0 : channelGain(v, "music"),
    ambient: world.meeting || !world.outdoors ? 0 : channelGain(v, "ambient"),
  };
}

/**
 * Advance the shared duck envelope one tick. The envelope glides in [DUCK_FACTOR,
 * 1] where 1 = no duck and DUCK_FACTOR = fully ducked. It moves toward DUCK_FACTOR
 * fast while voice is active (attack) and back toward 1 slowly once speech stops
 * (release), reusing fadeStep's exact-landing linear glide. The glue multiplies
 * this scalar onto both world loops' faded base gains.
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
  return fadeStep(current, target, dtMs, fadeMs);
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
  "open-arcade": { clip: "arcade_start", channel: "sfx" },
  "arcade-point": { clip: "arcade_point", channel: "sfx" },
  "arcade-over": { clip: "arcade_over", channel: "sfx" },
  // Board-game tables (PRD 11 phase 2): reuse the existing sit/arcade cues — the
  // game stays audio-agnostic and emits these domain events; the mixer decides.
  "board-sat": { clip: "sit", channel: "sfx" },
  "board-move": { clip: "arcade_point", channel: "sfx" },
  "board-win": { clip: "arcade_over", channel: "sfx" },
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
