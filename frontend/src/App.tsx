import { useEffect, useState } from "react";
import GameCanvas from "./game/GameCanvas";
import ChatBox from "./ui/ChatBox";
import RoomKeyModal from "./ui/RoomKeyModal";
import BubbleLayer from "./ui/BubbleLayer";
import MediaControls from "./ui/MediaControls";
import InteractionHint from "./ui/InteractionHint";
import { authenticate, USE_MOCK } from "./net/auth";
import { sharedNet } from "./net/shared";
import { bus } from "./game/eventBus";
import { worldAudio, roomVideo } from "./media/livekit";
import "./App.css";

const SPACE_ID = "1";

export default function App() {
  const [entered, setEntered] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Real mode: world proximity audio + per-room video, driven by net + seat events.
  useEffect(() => {
    if (!entered || USE_MOCK) return;
    const net = sharedNet();
    let selfId = net.selfId;
    const offInit = net.on("init", (p: { selfId: string }) => {
      selfId = p.selfId;
      void worldAudio.start(SPACE_ID, selfId);
    });
    const offSeat = net.on(
      "seat-update",
      (p: { roomId: string; playerId: string | null }) => {
        if (p.playerId && p.playerId === selfId) void roomVideo.join(p.roomId, selfId);
      }
    );
    const offStood = bus.on("stood", () => void roomVideo.leave());
    if (selfId) void worldAudio.start(SPACE_ID, selfId);
    return () => {
      offInit();
      offSeat();
      offStood();
      void roomVideo.leave();
      void worldAudio.stop();
    };
  }, [entered]);

  const join = async () => {
    const username = name.trim() || "Guest";
    setError(null);
    if (USE_MOCK) {
      localStorage.setItem("token", "dev-token");
      localStorage.setItem("displayName", username);
      setEntered(true);
      return;
    }
    setBusy(true);
    try {
      const token = await authenticate(username, password || "password123");
      localStorage.setItem("token", token);
      localStorage.setItem("displayName", username);
      setEntered(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  };

  if (!entered) {
    return (
      <div className="login">
        <div className="login-card">
          <h1>🌐 Metaverse</h1>
          <p className="login-sub">
            {USE_MOCK ? "Enter a name to join the space" : "Sign in to join the space"}
          </p>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Username"
            onKeyDown={(e) => e.key === "Enter" && USE_MOCK && join()}
          />
          {!USE_MOCK && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              onKeyDown={(e) => e.key === "Enter" && join()}
            />
          )}
          {error && <div className="key-error">{error}</div>}
          <button onClick={join} disabled={busy}>
            {busy ? "Connecting…" : "Enter space"}
          </button>
          <div className="login-controls">
            WASD / arrows to move · E to sit · walk to a room door to enter
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <GameCanvas />
      <div className="hud">
        <InteractionHint />
        <BubbleLayer />
        <MediaControls />
        <ChatBox />
        <RoomKeyModal />
        <div className="presence">🟢 connected</div>
      </div>
    </div>
  );
}
