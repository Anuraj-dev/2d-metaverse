import { useEffect } from "react";
import { bus } from "../game/eventBus";
import { speakingState } from "../media/speakingState";
import { localModeration } from "../media/localModeration";

/**
 * Headless bridge (PRD 20): forwards the shared active-speaker set onto the event
 * bus (`speaking`{ids}) so the Phaser scene can draw speaking rings without importing
 * the media layer — the same event-bus seam the rest of the HUD uses. Meeting tiles
 * read `speakingState` directly.
 *
 * Muted/blocked speakers are dropped from the emitted set (PRD 25.13) so a
 * suppressed player never lights up a speaking ring for this viewer. Both the
 * speaker set and the mute/block set can change, so the latest of each is
 * re-filtered and re-emitted.
 */
export default function SpeakingBridge() {
  useEffect(() => {
    const emit = () =>
      bus.emit("speaking", { ids: localModeration.filterSpeaking(speakingState.speaking) });
    const offSpeaking = speakingState.subscribe(emit);
    const offModeration = localModeration.subscribe(emit);
    return () => {
      offSpeaking();
      offModeration();
    };
  }, []);
  return null;
}
