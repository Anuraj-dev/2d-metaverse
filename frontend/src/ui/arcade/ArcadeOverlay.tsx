import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { Maximize, Volume2, VolumeX, X } from "lucide-react";
import type { ArcadeGame, ArcadeLeaderboard } from "@metaverse/shared";
import { toSeed } from "../../game/arcade/prng";
import { fetchLeaderboard, submitScore } from "../../net/arcade";
import { getSettings, setSettings, subscribeSettings } from "../settings";
import SnakeGame from "./SnakeGame";
import FlappyGame from "./FlappyGame";
import type { ArcadeGameProps } from "./gameTypes";
import "./arcade.css";

const GAMES: Record<ArcadeGame, ComponentType<ArcadeGameProps>> = {
  snake: SnakeGame,
  flappy: FlappyGame,
};

const CONTROLS: Record<ArcadeGame, string> = {
  snake: "Arrows / WASD to steer",
  flappy: "Space / ↑ / click to flap",
};

export interface ArcadeOverlayProps {
  game: ArcadeGame;
  label: string;
  onClose: () => void;
}

/**
 * Full-screen arcade surface. Hosts one game on its own canvas/DOM, shows the
 * live score + leaderboard, and owns run lifecycle (restart, score submit),
 * robust keyboard focus, and a per-arcade sound control. It requests the browser
 * Fullscreen API on open (with a graceful CSS-maximized fallback when denied)
 * and exits fullscreen on close. Escape closes instantly. The world scene sleeps
 * underneath (WorldScene reacts to open-arcade/close-arcade).
 */
export default function ArcadeOverlay({ game, label, onClose }: ArcadeOverlayProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [seed, setSeed] = useState(() => toSeed(Date.now()));
  const [score, setScore] = useState(0);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [board, setBoard] = useState<ArcadeLeaderboard | null>(null);
  const [paused, setPaused] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Arcade sound settings (own volume + mute), mirrored from the shared store.
  const [arcadeVolume, setArcadeVolume] = useState(() => getSettings().arcadeVolume);
  const [muteArcade, setMuteArcade] = useState(() => getSettings().muteArcade);

  const onScore = useCallback((s: number) => setScore(s), []);
  const onGameOver = useCallback((s: number) => setFinalScore(s), []);

  // Keep the local sound-control mirror in sync with the shared settings store
  // (e.g. if the global Settings panel changes it while the overlay is open).
  useEffect(
    () =>
      subscribeSettings((s) => {
        setArcadeVolume(s.arcadeVolume);
        setMuteArcade(s.muteArcade);
      }),
    []
  );

  // Take and hold keyboard focus robustly: blur whatever had focus (e.g. a
  // lingering HUD text input like the chat field, which otherwise swallows game
  // keys via the scene's isTyping guard) and focus our own container.
  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    containerRef.current?.focus();
  }, []);

  // Request browser fullscreen on the backdrop when the overlay opens; fall back
  // silently to the CSS-maximized overlay if the browser denies it (e.g. no user
  // activation left, or the API is unavailable in this environment/jsdom). The
  // header also offers a manual toggle that always runs from a real user gesture.
  useEffect(() => {
    const el = backdropRef.current;
    void el?.requestFullscreen?.().catch(() => {
      /* denied — the CSS-maximized overlay already fills the viewport */
    });
    const onFsChange = () => setIsFullscreen(document.fullscreenElement === el);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      // Leaving the arcade: drop fullscreen if we still own it.
      if (document.fullscreenElement === el) void document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = backdropRef.current;
    if (document.fullscreenElement === el) void document.exitFullscreen?.().catch(() => {});
    else void el?.requestFullscreen?.().catch(() => {});
  }, []);

  // Close wrapper: exit fullscreen first, then hand control back to the parent
  // (which unmounts us and wakes the world scene via close-arcade).
  const handleClose = useCallback(() => {
    if (document.fullscreenElement === backdropRef.current) {
      void document.exitFullscreen?.().catch(() => {});
    }
    onClose();
  }, [onClose]);

  // Load the leaderboard for this cabinet.
  const refresh = useCallback(() => {
    fetchLeaderboard(game)
      .then(setBoard)
      .catch(() => setBoard(null));
  }, [game]);
  useEffect(refresh, [refresh]);

  // Escape closes instantly (capture so nothing downstream eats it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [handleClose]);

  // Pause when the overlay loses visibility or the window loses focus.
  useEffect(() => {
    const update = () => setPaused(document.hidden);
    const onBlur = () => setPaused(true);
    const onFocus = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // On game over, submit the run's score and refresh the board.
  useEffect(() => {
    if (finalScore === null) return;
    submitScore(game, finalScore)
      .then(setBoard)
      .catch(() => refresh());
  }, [finalScore, game, refresh]);

  const restart = () => {
    setFinalScore(null);
    setScore(0);
    setSeed(toSeed(Date.now()));
  };

  const Game = GAMES[game];

  return (
    <div
      className="arcade-backdrop"
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${label} arcade`}
    >
      <div className="arcade-overlay" ref={containerRef} tabIndex={-1}>
        <header className="arcade-header">
          <h2>{label}</h2>
          <div className="arcade-tools">
            <div className="arcade-sound" title="Arcade sound">
              <button
                className="icon-btn arcade-icon-btn"
                onClick={() => setSettings({ muteArcade: !muteArcade })}
                aria-label={muteArcade ? "Unmute arcade sound" : "Mute arcade sound"}
                aria-pressed={muteArcade}
              >
                {muteArcade ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
              </button>
              <input
                className="arcade-vol"
                type="range"
                min={0}
                max={100}
                value={Math.round(arcadeVolume * 100)}
                onChange={(e) =>
                  setSettings({ arcadeVolume: Number(e.target.value) / 100, muteArcade: false })
                }
                aria-label="Arcade volume"
              />
            </div>
            <button
              className="icon-btn arcade-icon-btn"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              aria-pressed={isFullscreen}
            >
              <Maximize size={16} aria-hidden="true" />
            </button>
            <button className="arcade-close" onClick={handleClose} aria-label="Close arcade">
              Esc <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="arcade-body">
          <div className="arcade-stage">
            <div className="arcade-scoreline">
              <span className="arcade-score">Score {score}</span>
              <span className="arcade-controls-hint">{CONTROLS[game]}</span>
            </div>
            <div className="arcade-surface">
              {/* key=seed remounts the game for a fresh, deterministic run. */}
              <Game
                key={seed}
                seed={seed}
                paused={paused || finalScore !== null}
                onScore={onScore}
                onGameOver={onGameOver}
              />
              {finalScore !== null && (
                <div className="arcade-gameover">
                  <p>Game over</p>
                  <p className="arcade-final">Score {finalScore}</p>
                  <button className="arcade-play-again" onClick={restart}>
                    Play again
                  </button>
                </div>
              )}
              {paused && finalScore === null && (
                <div className="arcade-gameover">
                  <p>Paused</p>
                </div>
              )}
            </div>
          </div>

          <aside className="arcade-leaderboard">
            <h3>Leaderboard</h3>
            <p className="arcade-best">Your best: {board?.best ?? "—"}</p>
            <ol>
              {(board?.top ?? []).map((row, i) => (
                <li key={`${row.username}-${i}`}>
                  <span className="arcade-rank">{i + 1}</span>
                  <span className="arcade-name">{row.username}</span>
                  <span className="arcade-pts">{row.score}</span>
                </li>
              ))}
              {(board?.top ?? []).length === 0 && (
                <li className="arcade-empty">No scores yet — be the first!</li>
              )}
            </ol>
          </aside>
        </div>
      </div>
    </div>
  );
}
