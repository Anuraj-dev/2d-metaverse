import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { Maximize, Volume2, VolumeX, Vibrate, VibrateOff, X } from "lucide-react";
import type { ArcadeGame, ArcadeLeaderboard } from "@metaverse/shared";
import { toSeed } from "../../game/arcade/prng";
import type { SnakeLevelId, SnakeSpeedId } from "../../game/arcade/snake";
import { isNewBest } from "../../game/arcade/feedback";
import { bus } from "../../game/eventBus";
import { fetchLeaderboard, submitScore } from "../../net/arcade";
import { getSettings, setSettings, subscribeSettings } from "../settings";
import SnakeGame from "./SnakeGame";
import FlappyGame from "./FlappyGame";
import SnakeOptions from "./SnakeOptions";
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

/** Keys that instantly start a new run from the game-over card. */
const RESTART_KEYS = new Set([" ", "Enter", "r", "R"]);

/**
 * How long the finished run stays visible (loop running, card hidden) so the
 * death burst + shake can be seen before the game-over card covers the canvas.
 * Purely presentation: the final score is recorded and submitted immediately at
 * the terminal tick — closing or restarting during the freeze never loses it.
 */
const DEATH_FREEZE_MS = 450;

/**
 * The best standing before the current run. Unknown until the leaderboard
 * fetch resolves — a personal best is only ever announced from authoritative
 * data, never from a fetch that has not answered yet.
 */
type KnownBest = { known: false } | { known: true; best: number | null };

export interface ArcadeOverlayProps {
  game: ArcadeGame;
  label: string;
  onClose: () => void;
}

/**
 * Full-screen arcade surface. Hosts one game on its own canvas/DOM, shows the
 * live score + leaderboard, and owns run lifecycle (restart, score submit),
 * robust keyboard focus, and per-arcade sound + screen-shake controls. It
 * requests the browser Fullscreen API on open (with a graceful CSS-maximized
 * fallback when denied) and exits fullscreen on close. Escape closes instantly.
 * The world scene sleeps underneath (WorldScene reacts to open-arcade/close-arcade).
 *
 * Per-game options (Snake's speed + level) are persisted in the shared settings
 * store and applied by starting a new run, which remounts the game component —
 * the renderers read their options once per run.
 */
export default function ArcadeOverlay({ game, label, onClose }: ArcadeOverlayProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // The run's identity is a monotonic id (the React key — unique even for
  // same-millisecond restarts) plus the gameplay seed, which mixes the id in so
  // back-to-back restarts never replay the identical run.
  const [run, setRun] = useState(() => ({ id: 1, seed: toSeed(Date.now()) }));
  const [score, setScore] = useState(0);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  // The death freeze: the run has ended (finalScore set, score submitted) but
  // the card is held back so the death juice stays visible. Presentation only.
  const [cardShown, setCardShown] = useState(false);
  const [newBest, setNewBest] = useState(false);
  const [board, setBoard] = useState<ArcadeLeaderboard | null>(null);
  const [paused, setPaused] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Arcade sound settings (own volume + mute) + the shake toggle, mirrored from
  // the shared store.
  const [arcadeVolume, setArcadeVolume] = useState(() => getSettings().arcadeVolume);
  const [muteArcade, setMuteArcade] = useState(() => getSettings().muteArcade);
  const [arcadeShake, setArcadeShake] = useState(() => getSettings().arcadeShake);
  const [snakeSpeed, setSnakeSpeed] = useState<SnakeSpeedId>(() => getSettings().snakeSpeed);
  const [snakeLevel, setSnakeLevel] = useState<SnakeLevelId>(() => getSettings().snakeLevel);

  const onScore = useCallback((s: number) => setScore(s), []);

  // Keep the local settings mirror in sync with the shared store (e.g. if the
  // global Settings panel changes something while the overlay is open).
  useEffect(
    () =>
      subscribeSettings((s) => {
        setArcadeVolume(s.arcadeVolume);
        setMuteArcade(s.muteArcade);
        setArcadeShake(s.arcadeShake);
        setSnakeSpeed(s.snakeSpeed);
        setSnakeLevel(s.snakeLevel);
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

  // ── Pre-run best + celebration (event-driven — decided in the game-over and
  // response callbacks, never derived in effects) ───────────────────────────
  // The authoritative best standing before the current run; unknown until a
  // leaderboard response has been absorbed. Refs, because the deciders are
  // event callbacks, not renders.
  const knownBestRef = useRef<KnownBest>({ known: false });
  const finalScoreRef = useRef<number | null>(null);
  // Set when a run ends before any authoritative data arrived: only a pre-run
  // FETCH response settles the deferred celebration, never the submit
  // response — see absorbBoard.
  const awaitingBestRef = useRef(false);

  // True while mounted: a leaderboard response landing after close must be
  // inert — it would otherwise decide a best and emit a global sound event
  // with the arcade gone. (Re-armed on mount for StrictMode re-runs.)
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Monotonic request identity, stamped at dispatch time. Baseline and aside
  // updates are refused from any response older than the newest one already
  // absorbed, so a stale pre-run fetch resolving after the submit POST can
  // never regress the post-submit baseline for future runs.
  const reqSeqRef = useRef(0);
  const lastAbsorbedRef = useRef(0);

  const decideBest = useCallback((score: number, best: number | null) => {
    const better = isNewBest(score, best);
    setNewBest(better);
    // Audio-agnostic: emit the domain event and let the sound mixer pick a clip.
    if (better) bus.emit("arcade-best");
  }, []);

  // Every leaderboard response funnels through here with its request identity
  // and purpose. Only a FETCH response may settle a deferred celebration: it
  // carries pre-run data, while a submit response already includes the
  // just-submitted run (deciding from it would compare the score against
  // itself and suppress a genuine best). The staleness check comes second on
  // purpose — a late pre-run fetch is exactly the authority a deferred
  // decision is waiting for, even when it may no longer update the baseline.
  const absorbBoard = useCallback(
    (b: ArcadeLeaderboard, reqId: number, source: "fetch" | "submit") => {
      if (!aliveRef.current) return;
      if (source === "fetch" && awaitingBestRef.current && finalScoreRef.current !== null) {
        awaitingBestRef.current = false;
        decideBest(finalScoreRef.current, b.best);
      }
      if (reqId < lastAbsorbedRef.current) return; // stale — never regress
      lastAbsorbedRef.current = reqId;
      setBoard(b);
      knownBestRef.current = { known: true, best: b.best };
    },
    [decideBest]
  );

  // Load the leaderboard for this cabinet.
  const refresh = useCallback(() => {
    const reqId = ++reqSeqRef.current;
    fetchLeaderboard(game)
      .then((b) => absorbBoard(b, reqId, "fetch"))
      .catch(() => {
        if (aliveRef.current && reqId >= lastAbsorbedRef.current) setBoard(null);
      });
  }, [game, absorbBoard]);
  useEffect(refresh, [refresh]);

  const onGameOver = useCallback(
    (s: number) => {
      finalScoreRef.current = s;
      setFinalScore(s);
      // Persistence is decoupled from the death-freeze presentation: submit the
      // moment the run ends, so closing or restarting mid-freeze never loses it.
      const reqId = ++reqSeqRef.current;
      submitScore(game, s)
        .then((b) => absorbBoard(b, reqId, "submit"))
        .catch(() => {
          // A failed submit leaves the server pre-run: re-fetching restores
          // the aside and (being a fetch) can settle a deferred best.
          if (aliveRef.current) refresh();
        });
      // Decide the personal best only from authoritative pre-run data:
      // immediately when known, otherwise once the pre-run fetch lands.
      const kb = knownBestRef.current;
      if (kb.known) decideBest(s, kb.best);
      else awaitingBestRef.current = true;
    },
    [game, absorbBoard, refresh, decideBest]
  );

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

  const restart = useCallback(() => {
    finalScoreRef.current = null;
    awaitingBestRef.current = false;
    setFinalScore(null);
    setCardShown(false);
    setNewBest(false);
    setScore(0);
    setRun((r) => ({ id: r.id + 1, seed: toSeed(Date.now() + r.id) }));
  }, []);

  // Hold the game-over card back for the death freeze (loop keeps running so
  // the death juice animates), then pause the game and show the card. A restart
  // or unmount during the freeze just cancels the presentation — the score was
  // already submitted the moment the run ended.
  useEffect(() => {
    if (finalScore === null) return;
    const t = window.setTimeout(() => setCardShown(true), DEATH_FREEZE_MS);
    return () => window.clearTimeout(t);
  }, [finalScore]);

  // One-key instant restart from the game-over card (issue #163). Active only
  // while the card is actually shown, and never for key events originating from
  // an interactive control — keyboard users must still be able to activate
  // Close/fullscreen/mute/shake with Space/Enter while the card is up.
  useEffect(() => {
    if (!cardShown) return;
    const onKey = (e: KeyboardEvent) => {
      if (!RESTART_KEYS.has(e.key)) return;
      if (e.target instanceof Element && e.target.closest("button, input, select, textarea, a[href]")) {
        return;
      }
      e.preventDefault();
      restart();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cardShown, restart]);

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
              onClick={() => setSettings({ arcadeShake: !arcadeShake })}
              aria-label={arcadeShake ? "Turn screen shake off" : "Turn screen shake on"}
              aria-pressed={arcadeShake}
              title="Screen shake"
            >
              {arcadeShake ? <Vibrate size={16} aria-hidden="true" /> : <VibrateOff size={16} aria-hidden="true" />}
            </button>
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
            {game === "snake" && (
              <SnakeOptions
                speed={snakeSpeed}
                level={snakeLevel}
                onPickSpeed={(id) => {
                  setSettings({ snakeSpeed: id });
                  restart();
                }}
                onPickLevel={(id) => {
                  setSettings({ snakeLevel: id });
                  restart();
                }}
              />
            )}
            <div className="arcade-scoreline">
              <span className="arcade-score">Score {score}</span>
              <span className="arcade-controls-hint">{CONTROLS[game]}</span>
            </div>
            <div className="arcade-surface">
              {/* key=run.id remounts the game for a fresh, deterministic run.
                  The game keeps running through the death freeze (cardShown
                  still false) so the death juice stays visible. */}
              <Game
                key={run.id}
                seed={run.seed}
                paused={paused || cardShown}
                shake={arcadeShake}
                onScore={onScore}
                onGameOver={onGameOver}
              />
              {finalScore !== null && cardShown && (
                <div className="arcade-gameover">
                  <p>Game over</p>
                  <p className="arcade-final">Score {finalScore}</p>
                  {newBest && <p className="arcade-newbest">New personal best!</p>}
                  <button className="arcade-play-again" onClick={restart}>
                    Play again
                  </button>
                  <p className="arcade-restart-hint">Press Space to play again</p>
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
