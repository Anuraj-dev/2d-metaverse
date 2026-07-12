/**
 * Reduced-motion glue (PRD 25.19). Thin bridge between the pure decision logic
 * (game/reducedMotion.ts) and the three motion surfaces:
 *  - CSS: stamps `data-reduced-motion="true|false"` on <html>, which App.css
 *    keys off to stop infinite pulses and simplify transitions;
 *  - Motion: `useReducedMotionConfig()` feeds `<MotionConfig reducedMotion>`;
 *  - Phaser: WorldScene reads `isReducedMotion()` before tweens/particles/pulses.
 *
 * The effective flag combines the user's explicit setting (ui/settings.ts) with
 * the OS `prefers-reduced-motion` query; the pure `resolveReducedMotion` decides
 * (explicit setting wins). This module owns the DOM reads (matchMedia, root
 * attribute) that the pure module must not touch. Recomputes on either input
 * changing so an OS toggle or a settings change updates every surface live.
 */
import { useSyncExternalStore } from "react";
import {
  motionConfigMode,
  resolveReducedMotion,
} from "../game/reducedMotion";
import { getSettings, subscribeSettings } from "./settings";

const QUERY = "(prefers-reduced-motion: reduce)";

/** matchMedia is absent in some test/SSR contexts — degrade to "no preference". */
function reducedMotionQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia(QUERY);
}

let effective = false;
let started = false;
const listeners = new Set<(reduced: boolean) => void>();

function compute(): boolean {
  const systemPrefersReduced = reducedMotionQuery()?.matches ?? false;
  return resolveReducedMotion(getSettings().reducedMotion, systemPrefersReduced);
}

function stampRoot(reduced: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(
    "data-reduced-motion",
    reduced ? "true" : "false",
  );
}

function recompute(): void {
  const next = compute();
  effective = next;
  stampRoot(next);
  listeners.forEach((cb) => cb(next));
}

/**
 * Wire up the media-query + settings subscriptions and stamp the initial root
 * attribute. Idempotent — safe to call once at bootstrap (main.tsx).
 */
export function initReducedMotion(): void {
  if (started) return;
  started = true;
  effective = compute();
  stampRoot(effective);

  const mq = reducedMotionQuery();
  // Older Safari exposes only addListener; guard both without a bare `!`.
  if (mq) {
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", recompute);
    } else if (typeof mq.addListener === "function") {
      mq.addListener(recompute);
    }
  }
  subscribeSettings(recompute);
}

/** The current effective reduced-motion flag (Phaser/imperative reads). */
export function isReducedMotion(): boolean {
  if (!started) effective = compute();
  return effective;
}

/** Subscribe to effective-flag changes; returns an unsubscribe. */
export function subscribeReducedMotion(cb: (reduced: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** React hook: the live effective flag. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, isReducedMotion, () => false);
}

/** React hook: the `MotionConfig reducedMotion` value for the live flag. */
export function useReducedMotionConfig(): "always" | "never" {
  return motionConfigMode(useReducedMotion());
}
