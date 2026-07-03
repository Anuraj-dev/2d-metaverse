import { useEffect, useRef, useState, lazy, Suspense } from "react";
import Roster from "./ui/Roster";
import Minimap from "./ui/Minimap";
import Settings from "./ui/Settings";
import TouchControls from "./ui/TouchControls";
import HelpOverlay from "./ui/HelpOverlay";
import SfxBridge from "./ui/SfxBridge";
import RoomKeyModal from "./ui/RoomKeyModal";
import BubbleLayer from "./ui/BubbleLayer";
import MediaControls from "./ui/MediaControls";
import InteractionHint from "./ui/InteractionHint";
import InteractableModal from "./ui/InteractableModal";
import StageScreen from "./ui/StageScreen";
import ChatBox from "./ui/ChatBox";
import ChatToast from "./ui/ChatToast";
import Landing from "./ui/Landing";
import MeetingCountdown from "./ui/MeetingCountdown";
import { USE_MOCK } from "./net/auth";
import { MISCONFIGURED } from "./net/config";
import { sharedNet } from "./net/shared";
import { bus } from "./game/eventBus";
import { worldAudio, roomVideo, stageVideo } from "./media/livekit";
import {
  MEETING_NONE,
  meetingUiReduce,
  type MeetingUiEvent,
  type MeetingUiState,
} from "./game/meetingUi";
import { HANDOFF_IDLE, handoffEvent, handoffStart, type HandoffState } from "./game/portalHandoff";
import "./App.css";

// Phaser (and the whole game scene) is heavy — load it only after entering.
const GameCanvas = lazy(() => import("./game/GameCanvas"));
// The meeting surface (motion + LiveKit React components) loads only when a
// portal actually fires, keeping the entry chunk inside the bundle budget.
const MeetingOverlay = lazy(() => import("./ui/MeetingOverlay"));

/** Server→client meeting lifecycle events (PRD 10), mirrored onto the bus. */
const MEETING_EVENTS = [
  "meeting-countdown",
  "meeting-countdown-canceled",
  "meeting-started",
  "meeting-ended",
  "meeting-participant-joined",
  "meeting-participant-left",
] as const;

interface PortalState {
  backdrop: string | null;
  revealed: boolean;
  seat: { sx: number; sy: number } | null;
}

const SPACE_ID = "1";

export default function App() {
  const [entered, setEntered] = useState(false);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selfId, setSelfId] = useState("");
  // Meeting lifecycle (PRD 10): reducer output for the HUD…
  const [meeting, setMeeting] = useState<MeetingUiState>(MEETING_NONE);
  // …and the portal/handoff visuals (backdrop snapshot, reveal flag, morph seat).
  const [portal, setPortal] = useState<PortalState | null>(null);
  // The media effect below rebinds this to feed "b-ready" into the handoff.
  const burstCovered = useRef<() => void>(() => {});

  // Connection lifecycle: only show "connected" once init lands; a connect_error
  // (e.g. rejected JWT) clears the session and returns the player to sign-in.
  useEffect(() => {
    if (!entered) return;
    const net = sharedNet();
    const offInit = net.on("init", (p: { selfId: string }) => {
      setConnected(true);
      setSelfId(p.selfId);
    });
    const offErr = net.on("connect_error", (p: { message: string }) => {
      localStorage.removeItem("token");
      setConnected(false);
      setEntered(false);
      setNotice(`Couldn't connect: ${p.message}. Please sign in again.`);
    });
    return () => {
      offInit();
      offErr();
    };
  }, [entered]);

  // Real mode: world proximity audio + per-room video, driven by net + seat events.
  useEffect(() => {
    if (!entered || USE_MOCK) return;
    const net = sharedNet();
    let selfId = net.selfId;
    let inPrivateRoom = false;
    let disposed = false;
    let mediaTransition = Promise.resolve();

    const transition = (operation: () => Promise<void>) => {
      mediaTransition = mediaTransition
        .catch((error) => console.warn("Previous media transition failed:", error))
        .then(async () => {
          if (!disposed) await operation();
        });
    };
    const startWorldAudio = () => {
      if (selfId && !inPrivateRoom) transition(() => worldAudio.start(SPACE_ID, selfId));
    };
    const offInit = net.on("init", (p: { selfId: string }) => {
      selfId = p.selfId;
      startWorldAudio();
    });
    const offRoomEntered = bus.on("room-entered", () => {
      inPrivateRoom = true;
      transition(async () => {
        await worldAudio.stop();
        await roomVideo.leave();
      });
    });
    const offSeat = net.on(
      "seat-update",
      (p: { roomId: string; playerId: string | null }) => {
        if (p.playerId && p.playerId === selfId) {
          transition(async () => {
            await worldAudio.stop();
            await roomVideo.join(p.roomId, selfId);
          });
        }
      }
    );
    const offStood = bus.on("stood", () => transition(() => roomVideo.leave()));
    const offRoomLeft = bus.on("room-left", () => {
      inPrivateRoom = false;
      transition(async () => {
        await roomVideo.leave();
        if (selfId) await worldAudio.start(SPACE_ID, selfId);
      });
    });
    const offNearStage = bus.on("near-stage", () => {
      if (selfId) transition(() => stageVideo.joinAsAudience(SPACE_ID, selfId));
    });
    const offLeaveStage = bus.on("leave-stage", () => transition(() => stageVideo.leave()));

    // ---- Meeting lifecycle + portal handoff (PRD 10) ----------------------
    // The pure rules live in game/meetingUi.ts (what this client shows/does)
    // and game/portalHandoff.ts (aligning Phaser's Phase A with React's
    // Phase B); this block is glue on the same media sequencer.
    let meetingState: MeetingUiState = MEETING_NONE;
    let handoff: HandoffState = HANDOFF_IDLE;
    let lastSelfScreen: { sx: number; sy: number } | null = null;
    // Settles the in-flight Phase A wait (see the portal-in transition below).
    // Non-null exactly while Phaser's cinematic is pending; called by
    // portal-phase-a-done (completion), by a portal-out (cancellation) and by
    // unmount (so teardown can never hang on an abandoned cinematic).
    let settlePhaseA: (() => void) | null = null;
    const offMeetingPositions = bus.on(
      "positions",
      (p: { players: { self: boolean; sx?: number; sy?: number }[] }) => {
        const selfPlayer = p.players.find((player) => player.self);
        if (selfPlayer && typeof selfPlayer.sx === "number" && typeof selfPlayer.sy === "number") {
          lastSelfScreen = { sx: selfPlayer.sx, sy: selfPlayer.sy };
        }
      },
    );
    const reveal = () => {
      setPortal((prev) => (prev ? { ...prev, revealed: true } : prev));
      bus.emit("meeting-grid-visible");
    };
    const feedHandoff = (event: "a-done" | "b-ready") => {
      const result = handoffEvent(handoff, event);
      handoff = result.state;
      if (result.reveal) reveal();
    };
    burstCovered.current = () => feedHandoff("b-ready");
    const offPhaseADone = bus.on("portal-phase-a-done", (p: { image: string | null }) => {
      setPortal((prev) => (prev ? { ...prev, backdrop: p.image } : prev));
      feedHandoff("a-done");
      settlePhaseA?.();
    });
    const applyMeetingEvent = (event: MeetingUiEvent) => {
      // Mirror onto the bus first: HUD/e2e observability regardless of outcome.
      bus.emit(event.type, event.payload);
      const { state, action } = meetingUiReduce(meetingState, selfId, event);
      meetingState = state;
      setMeeting(state);
      if (action === "portal-in") {
        handoff = handoffStart();
        setPortal({ backdrop: null, revealed: false, seat: lastSelfScreen });
        // Serialized on the media queue so Phase A starts only after the
        // pending seat-media transition (world stop → room join) settled —
        // and the op holds the queue until Phaser's cinematic COMPLETES
        // (portal-phase-a-done) or is CANCELED (portal-out / unmount below).
        // Resolving early would let a queued portal-exit overtake the still-
        // running zoom, whose late snapshot/sleep would then freeze the world.
        transition(
          () =>
            new Promise<void>((resolve) => {
              settlePhaseA = () => {
                settlePhaseA = null;
                resolve();
              };
              bus.emit("portal-enter");
            }),
        );
      } else if (action === "portal-out") {
        handoff = HANDOFF_IDLE;
        setPortal(null);
        bus.emit("meeting-grid-hidden");
        // Cancel a still-pending Phase A so the queue advances to the exit op;
        // the scene's portal-generation guard makes the abandoned cinematic's
        // callbacks inert (no late snapshot, no late sleep).
        settlePhaseA?.();
        transition(async () => {
          bus.emit("portal-exit");
        });
      }
    };
    const offMeetingEvents = MEETING_EVENTS.map((type) =>
      net.on(type, (payload) =>
        applyMeetingEvent({ type, payload } as MeetingUiEvent),
      ),
    );

    startWorldAudio();
    return () => {
      disposed = true;
      offInit();
      offRoomEntered();
      offSeat();
      offStood();
      offRoomLeft();
      offNearStage();
      offLeaveStage();
      offMeetingPositions();
      offPhaseADone();
      offMeetingEvents.forEach((off) => off());
      // Never let teardown wait on an abandoned cinematic.
      settlePhaseA?.();
      burstCovered.current = () => {};
      void mediaTransition.finally(async () => {
        await roomVideo.leave();
        await stageVideo.leave();
        await worldAudio.stop();
      });
    };
  }, [entered]);

  // Production build with no backend URL: fail clearly, never simulate a world.
  if (MISCONFIGURED) {
    return (
      <div className="login">
        <div className="login-card">
          <h1>⚠️ Misconfigured</h1>
          <p className="login-sub">
            This build has no <code>VITE_SERVER_URL</code>. Set it (and
            <code> VITE_USE_MOCK=0</code>) in your hosting environment.
          </p>
        </div>
      </div>
    );
  }

  if (!entered) {
    return (
      <Landing
        notice={notice}
        onEntered={() => {
          setNotice(null);
          setEntered(true);
        }}
      />
    );
  }

  return (
    <div className="app">
      <Suspense fallback={<div className="loading-space">Loading space…</div>}>
        <GameCanvas />
      </Suspense>
      <div className="hud">
        <InteractionHint />
        <BubbleLayer />
        <MediaControls />
        <Roster />
        <Minimap />
        <Settings />
        <HelpOverlay />
        <TouchControls />
        <SfxBridge />
        <RoomKeyModal />
        <InteractableModal />
        <StageScreen />
        <ChatBox />
        <ChatToast />
        {meeting.status === "countdown" && <MeetingCountdown durationMs={meeting.durationMs} />}
        {portal && meeting.status === "in-meeting" && (
          <Suspense fallback={null}>
            <MeetingOverlay
              backdrop={portal.backdrop}
              revealed={portal.revealed}
              participants={meeting.participants}
              selfId={selfId}
              seat={portal.seat}
              onBurstCovered={() => burstCovered.current()}
            />
          </Suspense>
        )}
        <div className={`presence ${connected ? "" : "pending"}`}>
          {connected ? "🟢 connected" : "🟡 connecting…"}
        </div>
      </div>
    </div>
  );
}
