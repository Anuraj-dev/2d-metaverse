import { useEffect } from "react";
import { bus } from "../game/eventBus";
import { speakingState } from "../media/speakingState";

/**
 * Headless bridge (PRD 20): forwards the shared active-speaker set onto the event
 * bus (`speaking`{ids}) so the Phaser scene can draw speaking rings without importing
 * the media layer — the same event-bus seam the rest of the HUD uses. Meeting tiles
 * read `speakingState` directly.
 */
export default function SpeakingBridge() {
  useEffect(
    () =>
      speakingState.subscribe((ids) => bus.emit("speaking", { ids: [...ids] })),
    [],
  );
  return null;
}
