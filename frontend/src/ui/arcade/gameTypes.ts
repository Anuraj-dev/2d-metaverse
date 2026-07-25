/**
 * Shared contract every arcade renderer implements. Renderers are thin: they
 * own a canvas/DOM surface, run the pure module's tick/reduce on a loop, draw
 * the returned state, and report score changes + game-over upward. No game
 * *rules* live in a renderer — those stay in game/arcade/*.
 */
export interface ArcadeGameProps {
  /** Seed for this run; a new run gets a fresh seed (deterministic module). */
  seed: number;
  /** When true the loop halts (overlay lost focus/visibility). */
  paused: boolean;
  /**
   * Live screen-shake preference. A LIVE prop, not a mount-time snapshot, so
   * toggling the accessibility control mid-run takes effect immediately; the
   * renderer combines it with the reduced-motion preference.
   */
  shake: boolean;
  /** Latest score, emitted whenever it changes. */
  onScore: (score: number) => void;
  /**
   * Fired once, IMMEDIATELY when the run reaches a terminal state, with the
   * final score. The overlay owns any death-freeze presentation (delaying the
   * card while the death juice plays); the renderer must never delay this
   * call — a deferred report can be lost if the component unmounts first.
   */
  onGameOver: (finalScore: number) => void;
}
