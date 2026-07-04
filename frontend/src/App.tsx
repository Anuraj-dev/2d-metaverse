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
import { ARCADE_GAMES, SERVER_EVENTS, type ArcadeGame, type BoardUpdatePayload } from "@metaverse/shared";
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
import { HANDOFF_IDLE, handoffReduce, type HandoffState } from "./game/portalHandoff";
import "./App.css";

// Phaser (and the whole game scene) is heavy — load it only after entering.
const GameCanvas = lazy(() => import("./game/GameCanvas"));
// The meeting surface (motion + LiveKit React components) loads only when a
// portal actually fires, keeping the entry chunk inside the bundle budget.
const MeetingOverlay = lazy(() => import("./ui/MeetingOverlay"));
// The arcade overlay + its game modules load only when a cabinet is opened,
// keeping snake/flappy/2048 out of the entry chunk (bundle budget).
const ArcadeOverlay = lazy(() => import("./ui/arcade/ArcadeOverlay"));
// The board-table panel + its board renderer load only when a player sits at (or
// walks up to an active) board table, keeping it out of the entry chunk.
const BoardTablePanel = lazy(() => import("./ui/BoardTablePanel"));

function isArcadeGame(value: string): value is ArcadeGame {
  return (ARCADE_GAMES as readonly string[]).includes(value);
}

/** A board snapshot worth showing a passing spectator (an occupied table). */
function boardIsLive(snap: BoardUpdatePayload | undefined): boolean {
  return !!snap && (snap.phase !== "waiting" || snap.seats.some((s) => s !== null));
}

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
  // Arcade cabinet overlay (PRD 11): opened by a cabinet interact, null = closed.
  const [arcade, setArcade] = useState<{ game: ArcadeGame; label: string } | null>(null);
  // Board tables (PRD 11 phase 2): authoritative snapshots per table, the table
  // the panel currently shows (seated at, or standing beside a live match), and
  // the last rejection message.
  const [boardSnapshots, setBoardSnapshots] = useState<Record<string, BoardUpdatePayload>>({});
  const [boardSeatedTable, setBoardSeatedTable] = useState<string | null>(null);
  const [boardNearTable, setBoardNearTable] = useState<string | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
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

  // Arcade cabinets: the scene emits open-arcade with a game id; mount the lazy
  // overlay (which loads the game modules on first open). The world scene sleeps
  // itself on open and wakes on close-arcade (emitted below).
  useEffect(() => {
    if (!entered) return;
    return bus.on<{ game: string; label: string }>("open-arcade", (p) => {
      if (isArcadeGame(p.game)) setArcade({ game: p.game, label: p.label });
    });
  }, [entered]);

  // Board tables (PRD 11 phase 2): keep authoritative snapshots, drive the sound
  // cues off state transitions, and track which table the panel should show.
  useEffect(() => {
    if (!entered) return;
    const net = sharedNet();
    const prev = new Map<string, BoardUpdatePayload>();

    const offUpdate = net.on(SERVER_EVENTS.boardUpdate, (snap: BoardUpdatePayload) => {
      const before = prev.get(snap.tableId);
      prev.set(snap.tableId, snap);
      const filled = (s?: BoardUpdatePayload) => s?.state?.board.filter((c) => c !== 0).length ?? 0;
      if (snap.phase === "active" && filled(snap) > filled(before)) bus.emit("board-move");
      if (snap.phase === "over" && before?.phase !== "over") bus.emit("board-win");
      setBoardSnapshots((current) => ({ ...current, [snap.tableId]: snap }));
    });
    const offError = net.on(SERVER_EVENTS.boardError, (err: { tableId: string; reason: string }) => {
      const messages: Record<string, string> = {
        "not-your-turn": "Not your turn",
        "illegal-move": "Illegal move",
        "seat-taken": "Seat taken",
        "not-seated": "Sit down to play",
        "no-match": "No match in progress",
      };
      setBoardError(messages[err.reason] ?? "Move rejected");
      window.setTimeout(() => setBoardError(null), 1800);
    });
    const offSat = bus.on<{ tableId: string }>("board-sat", (p) => {
      setBoardSeatedTable(p.tableId);
      setBoardError(null);
    });
    const offStood = bus.on("board-stood", () => setBoardSeatedTable(null));
    const offNear = bus.on<{ tableId: string }>("near-board-seat", (p) => setBoardNearTable(p.tableId));
    const offLeaveNear = bus.on("leave-board-seat", () => setBoardNearTable(null));
    return () => {
      offUpdate();
      offError();
      offSat();
      offStood();
      offNear();
      offLeaveNear();
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
    // Settles the in-flight Phase A wait (see armPortalEnter below). Non-null
    // exactly while Phaser's cinematic is pending its media-queue op; called on
    // Phase A completion, on cancellation (portal-out) and on unmount, so the
    // held queue op can never hang. `phaseACanceled` covers the race where a
    // leave arrives BEFORE the queued enter op has even started: the op then
    // resolves immediately and never emits portal-enter (no cinematic to a
    // world we already left — the wedge this fix kills).
    let settlePhaseA: (() => void) | null = null;
    let phaseACanceled = false;
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
    // Arm Phase A: serialized on the media queue so the cinematic starts only
    // after the pending seat-media transition (world stop → room join) settled,
    // and the op HOLDS the queue until Phase A COMPLETES (portal-phase-a-done)
    // or is CANCELED. Resolving early would let a queued portal-exit overtake
    // the still-running zoom, whose late snapshot/sleep would freeze the world.
    // If a leave already fired before this op runs (phaseACanceled), it resolves
    // at once and never emits portal-enter — no cinematic into a world we left.
    const armPortalEnter = () => {
      phaseACanceled = false;
      setPortal({ backdrop: null, revealed: false, seat: lastSelfScreen });
      transition(
        () =>
          new Promise<void>((resolve) => {
            if (phaseACanceled) {
              resolve();
              return;
            }
            settlePhaseA = () => {
              settlePhaseA = null;
              resolve();
            };
            bus.emit("portal-enter");
          }),
      );
    };
    // Enact one pure handoff decision. `settle` both marks the entry canceled
    // (so a not-yet-started enter op will skip) and releases a pending one.
    const applyHandoff = (event: "portal-in" | "portal-out" | "a-done" | "b-ready" | "teardown") => {
      const d = handoffReduce(handoff, event);
      handoff = d.state;
      if (d.enter) armPortalEnter();
      if (d.settle) {
        phaseACanceled = true;
        settlePhaseA?.();
      }
      if (d.reveal) reveal();
      if (d.exit) {
        setPortal(null);
        bus.emit("meeting-grid-hidden");
        // The scene's portal-generation guard makes any abandoned cinematic's
        // callbacks inert; the exit op wakes the render loop.
        transition(async () => {
          bus.emit("portal-exit");
        });
      }
    };
    burstCovered.current = () => applyHandoff("b-ready");
    const offPhaseADone = bus.on("portal-phase-a-done", (p: { image: string | null }) => {
      setPortal((prev) => (prev ? { ...prev, backdrop: p.image } : prev));
      applyHandoff("a-done");
    });
    const applyMeetingEvent = (event: MeetingUiEvent) => {
      // Mirror onto the bus first: HUD/e2e observability regardless of outcome.
      bus.emit(event.type, event.payload);
      const { state, action } = meetingUiReduce(meetingState, selfId, event);
      meetingState = state;
      setMeeting(state);
      if (action === "portal-in") applyHandoff("portal-in");
      else if (action === "portal-out") applyHandoff("portal-out");
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
      // Never let teardown wait on an abandoned cinematic (releases the held
      // Phase A op via the machine's `settle`).
      applyHandoff("teardown");
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
        {arcade && (
          <Suspense fallback={null}>
            <ArcadeOverlay
              game={arcade.game}
              label={arcade.label}
              onClose={() => {
                setArcade(null);
                bus.emit("close-arcade");
              }}
            />
          </Suspense>
        )}
        {(() => {
          const tableId =
            boardSeatedTable ?? (boardIsLive(boardNearTable ? boardSnapshots[boardNearTable] : undefined) ? boardNearTable : null);
          const snapshot = tableId ? boardSnapshots[tableId] : undefined;
          if (!snapshot) return null;
          const net = sharedNet();
          return (
            <Suspense fallback={null}>
              <BoardTablePanel
                snapshot={snapshot}
                selfId={selfId}
                error={boardError}
                onMove={(index) => net.boardMove(snapshot.tableId, index)}
                onAccept={() => net.boardAccept(snapshot.tableId)}
                onLeave={() => bus.emit("do-stand")}
              />
            </Suspense>
          );
        })()}
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
