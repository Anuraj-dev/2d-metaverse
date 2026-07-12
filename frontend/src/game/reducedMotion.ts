/**
 * Reduced-motion decision logic (PRD 25.19) — pure module, no DOM/Phaser/net.
 *
 * ONE global preference, resolved from two inputs:
 *  - the user's explicit setting (persisted via ui/settings.ts), and
 *  - the OS `prefers-reduced-motion` media query.
 *
 * The explicit setting WINS when the user has chosen "on"/"off"; "system"
 * defers to the OS query. The thin glue that reads the media query and bridges
 * the result to CSS (a `data-reduced-motion` root attribute), Motion
 * (`MotionConfig`), and Phaser (WorldScene) lives in ui/reducedMotionBridge.ts.
 *
 * Consumers must SKIP the tween/particle/pulse, never the state transition:
 * a portal reveal still reaches its terminal state synchronously; only the
 * decorative motion is dropped.
 */

/**
 * The user's explicit choice. `"system"` follows the OS preference; `"on"` and
 * `"off"` override it in either direction.
 */
export type ReducedMotionSetting = "system" | "on" | "off";

/**
 * Resolve the effective reduced-motion flag from the explicit user setting and
 * the OS `prefers-reduced-motion: reduce` state. The explicit setting wins;
 * `"system"` mirrors the OS query.
 */
export function resolveReducedMotion(
  setting: ReducedMotionSetting,
  systemPrefersReduced: boolean,
): boolean {
  switch (setting) {
    case "on":
      return true;
    case "off":
      return false;
    case "system":
      return systemPrefersReduced;
  }
}

/** The `MotionConfig reducedMotion` value for the resolved flag. */
export function motionConfigMode(reduced: boolean): "always" | "never" {
  return reduced ? "always" : "never";
}
