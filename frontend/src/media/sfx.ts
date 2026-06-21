/**
 * Lightweight sound-effects player. Preloads short clips and plays them honoring
 * the user's volume / mute settings. Pure frontend; assets live in
 * public/assets/audio. Browsers block audio until the first user gesture, so we
 * stay silent (and swallow play() rejections) until then.
 */
import { getSettings } from "../ui/settings";

const BASE = "/assets/audio";

export type SfxName = "message" | "join" | "leave" | "sit";

const FILES: Record<SfxName, string> = {
  message: `${BASE}/message.wav`,
  join: `${BASE}/join.wav`,
  leave: `${BASE}/leave.wav`,
  sit: `${BASE}/sit.wav`,
};

const cache = new Map<SfxName, HTMLAudioElement>();

function el(name: SfxName): HTMLAudioElement {
  let a = cache.get(name);
  if (!a) {
    a = new Audio(FILES[name]);
    a.preload = "auto";
    cache.set(name, a);
  }
  return a;
}

/** Preload every clip so the first play is instant. Safe to call repeatedly. */
export function preloadSfx(): void {
  (Object.keys(FILES) as SfxName[]).forEach((n) => el(n).load());
}

/**
 * Play a sound. `notify` clips obey the `notifySound` toggle; gameplay clips obey
 * `muteSfx`. Both scale by `masterVolume`. Cloned per call so rapid repeats overlap.
 */
export function playSfx(name: SfxName, opts: { notify?: boolean } = {}): void {
  const s = getSettings();
  if (opts.notify ? !s.notifySound : s.muteSfx) return;
  const vol = Math.max(0, Math.min(1, s.masterVolume));
  if (vol <= 0) return;
  const node = el(name).cloneNode(true) as HTMLAudioElement;
  node.volume = vol;
  void node.play().catch(() => {
    /* autoplay blocked until first gesture — ignore */
  });
}
