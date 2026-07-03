import type { CSSProperties } from "react";
import { FRAME_W, FRAME_H, idleFrame } from "../game/avatar";
import { charForPlayer, isCharKey, type CharKey } from "../game/chars";

/**
 * A participant's in-game pixel sprite (idle pose, facing down, scaled) for
 * camera-off meeting tiles — game identity carries through the portal.
 *
 * Renders the exact frame the Phaser world uses: same spritesheet
 * (/assets/characters/<char>.png, 3×4 grid of 32×32) and the same
 * deterministic player→char mapping (game/chars.charForPlayer). Pass `char`
 * to override for the local player (their chosen avatar from localStorage).
 */
const SHEET_COLS = 3;
const SHEET_ROWS = 4;

export default function PixelAvatar({
  playerId,
  char,
  scale = 3,
}: {
  playerId: string;
  char?: string | undefined;
  scale?: number;
}) {
  const key: CharKey = char !== undefined && isCharKey(char) ? char : charForPlayer(playerId);
  const frame = idleFrame("down");
  const col = frame % SHEET_COLS;
  const row = Math.floor(frame / SHEET_COLS);
  const style: CSSProperties = {
    width: FRAME_W * scale,
    height: FRAME_H * scale,
    backgroundImage: `url(/assets/characters/${key}.png)`,
    backgroundPosition: `${-col * FRAME_W * scale}px ${-row * FRAME_H * scale}px`,
    backgroundSize: `${FRAME_W * SHEET_COLS * scale}px ${FRAME_H * SHEET_ROWS * scale}px`,
    backgroundRepeat: "no-repeat",
    imageRendering: "pixelated",
  };
  return <div className="pixel-avatar" data-char={key} style={style} aria-hidden="true" />;
}
