/**
 * The app typeface, for in-canvas Phaser text (loading text, nameplates, chat
 * bubbles, world text). Mirrors the CSS `--font-app` custom property so the
 * world and the HUD share one family. The leading self-hosted "Nunito Variable"
 * face is guarded behind `document.fonts` before world text is created (see
 * BootScene.create), so canvas text never paints the fallback then swaps.
 */
export const CANVAS_FONT_FAMILY =
  '"Nunito Variable", ui-rounded, "Segoe UI", system-ui, sans-serif';

/** The primary family only — used to prime `document.fonts.load(...)`. */
export const CANVAS_FONT_PRIMARY = "Nunito Variable";
