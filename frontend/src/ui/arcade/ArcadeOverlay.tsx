import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import type { ArcadeGame, ArcadeLeaderboard } from "@metaverse/shared";
import { toSeed } from "../../game/arcade/prng";
import { fetchLeaderboard, submitScore } from "../../net/arcade";
import SnakeGame from "./SnakeGame";
import FlappyGame from "./FlappyGame";
import Game2048 from "./Game2048";
import type { ArcadeGameProps } from "./gameTypes";
import "./arcade.css";

const GAMES: Record<ArcadeGame, ComponentType<ArcadeGameProps>> = {
  snake: SnakeGame,
  flappy: FlappyGame,
  "2048": Game2048,
};

const CONTROLS: Record<ArcadeGame, string> = {
  snake: "Arrows / WASD to steer",
  flappy: "Space / ↑ / click to flap",
  "2048": "Arrows / WASD to slide",
};

export interface ArcadeOverlayProps {
  game: ArcadeGame;
  label: string;
  onClose: () => void;
}

/**
 * Full-screen arcade surface. Hosts one game on its own canvas/DOM, shows the
 * live score + leaderboard, and owns run lifecycle (restart, score submit) and
 * robust keyboard focus. Escape closes instantly. The world scene sleeps
 * underneath (WorldScene reacts to open-arcade/close-arcade).
 */
export default function ArcadeOverlay({ game, label, onClose }: ArcadeOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [seed, setSeed] = useState(() => toSeed(Date.now()));
  const [score, setScore] = useState(0);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [board, setBoard] = useState<ArcadeLeaderboard | null>(null);
  const [paused, setPaused] = useState(false);

  const onScore = useCallback((s: number) => setScore(s), []);
  const onGameOver = useCallback((s: number) => setFinalScore(s), []);

  // Take and hold keyboard focus robustly: blur whatever had focus (e.g. a
  // lingering room-key input, which otherwise swallows game keys via the
  // scene's isTyping guard) and focus our own container.
  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    containerRef.current?.focus();
  }, []);

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
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

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
    <div className="arcade-backdrop" role="dialog" aria-modal="true" aria-label={`${label} arcade`}>
      <div className="arcade-overlay" ref={containerRef} tabIndex={-1}>
        <header className="arcade-header">
          <h2>{label}</h2>
          <button className="arcade-close" onClick={onClose} aria-label="Close arcade">
            Esc ✕
          </button>
        </header>

        <div className="arcade-body">
          <div className="arcade-stage">
            <div className="arcade-scoreline">
              <span>Score {score}</span>
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
            <p className="arcade-best">
              Your best: {board?.best ?? "—"}
            </p>
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
