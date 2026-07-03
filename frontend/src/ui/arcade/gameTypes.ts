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
  /** Latest score, emitted whenever it changes. */
  onScore: (score: number) => void;
  /** Fired once when the run ends, with the final score. */
  onGameOver: (finalScore: number) => void;
}
