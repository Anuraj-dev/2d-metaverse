import type { ArcadeGame } from "@metaverse/shared";

/** Terminal presentation hold per cabinet; Snake's death FX needs the longer hold. */
export const TERMINAL_HOLD_MS: Readonly<Record<ArcadeGame, number>> = {
  snake: 830,
  flappy: 450,
  "merge-drop": 450,
};
