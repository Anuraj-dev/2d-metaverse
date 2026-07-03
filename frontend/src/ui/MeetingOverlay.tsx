/**
 * Phase B of the portal transition + the meeting surface shell (PRD 10).
 *
 * Mounted by App the moment a portal-in begins. Sequence:
 *  1. The warp-burst (motion) expands from the seat and covers the viewport;
 *     when its animation completes we signal `onBurstCovered` (the app shell
 *     feeds "b-ready" into the pure handoff machine, game/portalHandoff.ts).
 *  2. Phaser finishes Phase A (zoom + fade + frame snapshot + scene sleep).
 *  3. When BOTH are done App flips `revealed`: the grid cross-fades in over
 *     the frozen, blurred, darkened snapshot of the game world while the
 *     burst fades out — no gap, no double-flash.
 *
 * Lazy-loaded (motion + LiveKit components stay out of the entry chunk).
 */
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import "@livekit/components-styles";
import type { MeetingParticipant } from "@metaverse/shared";
import { bus } from "../game/eventBus";
import { roomVideo } from "../media/livekit";
import MeetingGrid from "./MeetingGrid";

export interface MeetingOverlayProps {
  backdrop: string | null;
  revealed: boolean;
  participants: MeetingParticipant[];
  selfId: string;
  /** Self screen position at portal start — the burst origin + morph ghost. */
  seat: { sx: number; sy: number } | null;
  onBurstCovered: () => void;
}

export default function MeetingOverlay({
  backdrop,
  revealed,
  participants,
  selfId,
  seat,
  onBurstCovered,
}: MeetingOverlayProps) {
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const selfChar = localStorage.getItem("avatar") ?? undefined;

  const toggleMic = () => {
    const on = !mic;
    setMic(on);
    roomVideo.setMicEnabled(on);
  };
  const toggleCam = () => {
    const on = !cam;
    setCam(on);
    roomVideo.setCamEnabled(on);
  };

  const origin = seat ?? { sx: window.innerWidth / 2, sy: window.innerHeight / 2 };

  return (
    <div className="meeting-overlay" data-testid="meeting-overlay" data-revealed={revealed}>
      {revealed && (
        <div
          className="meeting-backdrop"
          style={backdrop ? { backgroundImage: `url(${backdrop})` } : undefined}
        />
      )}
      <AnimatePresence>
        {!revealed && (
          <motion.div
            key="burst"
            className="portal-burst"
            style={{ left: origin.sx, top: origin.sy }}
            initial={{ scale: 0.05, opacity: 0.35 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: "easeIn" }}
            onAnimationComplete={onBurstCovered}
          />
        )}
      </AnimatePresence>
      {!revealed && seat && (
        <motion.div
          layoutId="meet-tile-self"
          className="meet-seat-ghost"
          style={{ left: seat.sx - 24, top: seat.sy - 24 }}
        />
      )}
      {revealed && (
        <motion.div
          className="meeting-stage"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          <header className="meeting-topbar">
            <span className="meeting-title">Room meeting</span>
            <div className="meeting-actions">
              <button className={mic ? "on" : "off"} onClick={toggleMic} title="Mic">
                {mic ? "🎙️" : "🔇"}
              </button>
              <button className={cam ? "on" : "off"} onClick={toggleCam} title="Camera">
                {cam ? "📹" : "🚫"}
              </button>
              <button className="leave" onClick={() => bus.emit("do-stand")} title="Leave meeting">
                Leave
              </button>
            </div>
          </header>
          <MeetingGrid participants={participants} selfId={selfId} selfChar={selfChar} />
        </motion.div>
      )}
    </div>
  );
}
