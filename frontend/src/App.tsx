import { useEffect, useState, lazy, Suspense } from "react";
import ChatBox from "./ui/ChatBox";
import ChatToast from "./ui/ChatToast";
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
import { signUp, signIn, USE_MOCK } from "./net/auth";
import { MISCONFIGURED } from "./net/config";
import { sharedNet } from "./net/shared";
import { bus } from "./game/eventBus";
import { worldAudio, roomVideo } from "./media/livekit";
import "./App.css";

// Phaser (and the whole game scene) is heavy — load it only after entering.
const GameCanvas = lazy(() => import("./game/GameCanvas"));

const SPACE_ID = "1";
const CHARS = ["char1", "char2", "char3", "char4"];
type Mode = "signin" | "signup";

export default function App() {
  const [entered, setEntered] = useState(false);
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [avatar, setAvatar] = useState(
    () => localStorage.getItem("avatar") ?? "char1"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(`Couldn't connect: ${p.message}. Please sign in again.`);
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

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    const u = username.trim();
    localStorage.setItem("avatar", avatar);

    if (USE_MOCK) {
      if (!u) return setError("Enter a name to join.");
      localStorage.setItem("token", "dev-token");
      localStorage.setItem("displayName", u);
      setEntered(true);
      return;
    }

    if (!u || !password) return setError("Username and password are required.");
    setBusy(true);
    try {
      if (mode === "signup") await signUp(u, password);
      const token = await signIn(u, password);
      localStorage.setItem("token", token);
      localStorage.setItem("displayName", u);
      setEntered(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect.");
    } finally {
      setBusy(false);
    }
  };

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
    const cta = USE_MOCK
      ? busy
        ? "Connecting…"
        : "Enter space"
      : busy
        ? "Connecting…"
        : mode === "signup"
          ? "Create account"
          : "Sign in";
    return (
      <div className="login">
        <form className="login-card" onSubmit={submit}>
          <h1>🌐 Metaverse</h1>
          <p className="login-sub">
            {USE_MOCK
              ? "Enter a name to join the space"
              : mode === "signup"
                ? "Create an account to join"
                : "Sign in to join the space"}
          </p>

          {!USE_MOCK && (
            <div className="auth-tabs">
              <button
                type="button"
                className={mode === "signin" ? "active" : ""}
                onClick={() => {
                  setMode("signin");
                  setError(null);
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                className={mode === "signup" ? "active" : ""}
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
              >
                Sign up
              </button>
            </div>
          )}

          <div className="avatar-pick">
            {CHARS.map((c) => (
              <button
                key={c}
                type="button"
                className={`avatar-thumb ${avatar === c ? "sel" : ""}`}
                style={{ backgroundImage: `url(/assets/characters/${c}.png)` }}
                aria-label={`Choose ${c}`}
                aria-pressed={avatar === c}
                onClick={() => setAvatar(c)}
              />
            ))}
          </div>

          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
          />
          {!USE_MOCK && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          )}
          {error && <div className="key-error">{error}</div>}
          <button type="submit" disabled={busy}>
            {cta}
          </button>
          <div className="login-controls">
            WASD / arrows to move · Shift to run · E to sit · walk to a room door
            to enter · press ? for help
          </div>
        </form>
      </div>
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
        <ChatBox />
        <ChatToast />
        <Roster />
        <Minimap />
        <Settings />
        <HelpOverlay />
        <TouchControls />
        <SfxBridge />
        <RoomKeyModal />
        <div className={`presence ${connected ? "" : "pending"}`}>
          {connected ? "🟢 connected" : "🟡 connecting…"}
        </div>
      </div>
    </div>
  );
}
