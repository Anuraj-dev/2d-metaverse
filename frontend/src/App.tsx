import { useEffect, useState, lazy, Suspense } from "react";
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
import ChatBox from "./ui/ChatBox";
import ChatToast from "./ui/ChatToast";
import Landing from "./ui/Landing";
import { USE_MOCK } from "./net/auth";
import { MISCONFIGURED } from "./net/config";
import { sharedNet } from "./net/shared";
import { bus } from "./game/eventBus";
import { worldAudio, roomVideo } from "./media/livekit";
import "./App.css";

// Phaser (and the whole game scene) is heavy — load it only after entering.
const GameCanvas = lazy(() => import("./game/GameCanvas"));

const SPACE_ID = "1";

export default function App() {
  const [entered, setEntered] = useState(false);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Connection lifecycle: only show "connected" once init lands; a connect_error
  // (e.g. rejected JWT) clears the session and returns the player to sign-in.
  useEffect(() => {
    if (!entered) return;
    const net = sharedNet();
    const offInit = net.on("init", () => setConnected(true));
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
    startWorldAudio();
    return () => {
      disposed = true;
      offInit();
      offRoomEntered();
      offSeat();
      offStood();
      offRoomLeft();
      void mediaTransition.finally(async () => {
        await roomVideo.leave();
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
        <ChatBox />
        <ChatToast />
        <div className={`presence ${connected ? "" : "pending"}`}>
          {connected ? "🟢 connected" : "🟡 connecting…"}
        </div>
      </div>
    </div>
  );
}
