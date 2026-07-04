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
import type { MeetingChatLine } from "../game/meetingChat";
import { roomVideo } from "../media/livekit";
import MeetingGrid from "./MeetingGrid";
import MeetingChatPanel from "./MeetingChatPanel";

export interface MeetingOverlayProps {
  backdrop: string | null;
  revealed: boolean;
  participants: MeetingParticipant[];
  selfId: string;
  /** In-meeting chat transcript (participant-scoped; server-relayed). */
  chat: readonly MeetingChatLine[];
  /** Send a typed chat line to the meeting (app shell → net.meetingChat). */
  onSendChat: (text: string) => void;
  /** Self screen position at portal start — the burst origin + morph ghost. */
  seat: { sx: number; sy: number } | null;
  onBurstCovered: () => void;
}

/**
 * The gradient-tracing portal ring (Phase B decoration). An animated
 * cyan→purple→magenta pulse traces a ring that blooms from the seat: a rotating
 * group sweeps a stroked arc (dash gap over `pathLength`), layered with two
 * concentric rings fading in. Purely decorative — it never gates the handoff.
 */
function PortalRing({ origin }: { origin: { sx: number; sy: number } }) {
  const SIZE = 320;
  return (
    <svg
      className="portal-ring"
      width={SIZE}
      height={SIZE}
      viewBox="0 0 100 100"
      style={{ left: origin.sx - SIZE / 2, top: origin.sy - SIZE / 2 }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="portal-trace" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38d0ff" />
          <stop offset="45%" stopColor="#7c5cff" />
          <stop offset="100%" stopColor="#f0b4ff" />
        </linearGradient>
      </defs>
      <motion.g
        style={{ transformOrigin: "50px 50px" }}
        initial={{ rotate: 0 }}
        animate={{ rotate: 360 }}
        transition={{ duration: 1.1, ease: "linear", repeat: Infinity }}
      >
        <motion.circle
          cx="50"
          cy="50"
          r="38"
          fill="none"
          stroke="url(#portal-trace)"
          strokeWidth="4"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="0.55 0.45"
          initial={{ strokeDashoffset: 1, opacity: 0, scale: 0.35 }}
          animate={{ strokeDashoffset: 0, opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </motion.g>
      <motion.circle
        cx="50"
        cy="50"
        r="26"
        fill="none"
        stroke="url(#portal-trace)"
        strokeWidth="2"
        style={{ transformOrigin: "50px 50px" }}
        initial={{ scale: 0.2, opacity: 0 }}
        animate={{ scale: 1, opacity: 0.6 }}
        transition={{ duration: 0.45, delay: 0.05, ease: "easeOut" }}
      />
    </svg>
  );
}

export default function MeetingOverlay({
  backdrop,
  revealed,
  participants,
  selfId,
  chat,
  onSendChat,
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
            key="portal-fx"
            className="portal-fx"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            {/* Gradient-tracing ring: a cyan→purple energy pulse sweeping a
                portal ring that blooms from the seat, layered over concentric
                fade-ins. GPU-friendly (transform/opacity on the layers; only
                the small SVG stroke animates its dash). */}
            <PortalRing origin={origin} />
            {/* The expanding burst covers the viewport and morphs into the grid.
                Its completion is Phase B — feeds "b-ready" into the handoff. */}
            <motion.div
              className="portal-burst"
              style={{ left: origin.sx, top: origin.sy }}
              initial={{ scale: 0.05, opacity: 0.35 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: "easeIn", delay: 0.12 }}
              onAnimationComplete={onBurstCovered}
            />
          </motion.div>
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
          <div className="meeting-body">
            <MeetingGrid participants={participants} selfId={selfId} selfChar={selfChar} />
            <MeetingChatPanel lines={chat} onSend={onSendChat} />
          </div>
        </motion.div>
      )}
    </div>
  );
}
