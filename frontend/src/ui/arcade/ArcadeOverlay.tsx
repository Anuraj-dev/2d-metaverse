import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
} from "react";
import { Maximize, Minimize, Vibrate, VibrateOff, Volume2, VolumeX, X } from "lucide-react";
import type { ArcadeGame, ArcadeLeaderboard } from "@metaverse/shared";
import { toSeed } from "../../game/arcade/prng";
import { bus } from "../../game/eventBus";
import { fetchLeaderboard, submitScore } from "../../net/arcade";
import { getSettings, setSettings, subscribeSettings } from "../settings";
import SnakeGame from "./SnakeGame";
import FlappyGame from "./FlappyGame";
import MergeDropGame from "./MergeDropGame";
import {
  exitFullscreen,
  fullscreenAvailable,
  fullscreenElement,
  requestFullscreen,
  subscribeFullscreen,
} from "./fullscreen";
import type { ArcadeGameProps } from "./gameTypes";
import "./arcade.css";

const GAMES: Record<ArcadeGame, ComponentType<ArcadeGameProps>> = {
  snake: SnakeGame,
  flappy: FlappyGame,
  "merge-drop": MergeDropGame,
};

/** Fade-out budget before the parent unmounts us (matches the CSS transition). */
const CLOSE_FADE_MS = 140;

/**
 * Overlay lifecycle. One tagged union is the single source of truth for what
 * the surface shows and whether the game ticks (`paused` = anything but
 * `playing`).
 *
 * - `paused.reason` distinguishes a deliberate pause (menu) from one the
 *   browser forced on us: `fs-escape` (it ate an Escape to leave fullscreen)
 *   still shows the menu, `auto` (blur / tab hidden) shows only a scrim and
 *   resumes by itself.
 */
type Phase =
  | { k: "playing" }
  | { k: "paused"; reason: "user" | "fs-escape" | "auto" }
  | { k: "finishing"; score: number }
  | { k: "over"; score: number }
  | { k: "closing" };

const MENU_LENGTH = 3;
/** Let terminal particles/shake read before the game-over card covers them. */
const DEATH_FREEZE_MS = 450;

export interface ArcadeOverlayProps {
  game: ArcadeGame;
  label: string;
  onClose: () => void;
}

/** Reduced motion kills the close fade (the CSS does the same for animations). */
function closeFadeMs(): number {
  try {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
    }
  } catch {
    /* matchMedia unavailable — keep the default fade */
  }
  return CLOSE_FADE_MS;
}

/**
 * Full-bleed arcade surface. Hosts one game on its own canvas/DOM, shows the
 * live score + leaderboard, and owns run lifecycle (restart, score submit),
 * robust keyboard focus, and a per-arcade sound control.
 *
 * Display: the overlay covers the viewport with CSS on its own and NEVER takes
 * browser fullscreen by itself — browser fullscreen swallows the first Escape
 * to leave itself, which visibly shrinks the window before the page sees the
 * key. True fullscreen is an explicit opt-in via the header fullscreen toggle; the
 * geometry is identical either way.
 *
 * Escape is a pause, not a quit: it raises the pause menu (Resume / Restart /
 * Quit), which doubles as the quit confirmation (the header Quit button opens
 * the same menu with Quit pre-selected). When the browser eats an Escape to
 * leave fullscreen we see it as a fullscreen exit and pause the same way,
 * remembering that the user wanted fullscreen so Resume can take it back
 * (Resume is a real user gesture, so the request is allowed).
 *
 * The world scene sleeps underneath (WorldScene reacts to open/close-arcade).
 */
export default function ArcadeOverlay({ game, label, onClose }: ArcadeOverlayProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const playAgainRef = useRef<HTMLButtonElement>(null);
  /** Set while we tear the overlay down, so our own fullscreen exit is inert. */
  const closingRef = useRef(false);
  /** Set when the user deliberately leaves fullscreen via the header toggle. */
  const deliberateFsExitRef = useRef(false);
  /** True while the backdrop is the fullscreen element (read inside handlers). */
  const hadFullscreenRef = useRef(false);
  /**
   * User intent to be in fullscreen. A ref, not state: it is never rendered and
   * the fullscreenchange handler must read the freshest value.
   */
  const wantsFullscreenRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const [run, setRun] = useState(() => ({ id: 1, seed: toSeed(Date.now()) }));
  const [score, setScore] = useState(0);
  const [scoreBump, setScoreBump] = useState(false);
  const [phase, setPhase] = useState<Phase>({ k: "playing" });
  const [menuIndex, setMenuIndex] = useState(0);
  /** Last run's final score, kept so the game-over card can't blank mid-fade. */
  const [lastFinal, setLastFinal] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [board, setBoard] = useState<ArcadeLeaderboard | null>(null);
  const [boardError, setBoardError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fsPending, setFsPending] = useState(false);
  const [fsAvailable, setFsAvailable] = useState(true);
  // Arcade sound settings (own volume + mute), mirrored from the shared store.
  const [arcadeVolume, setArcadeVolume] = useState(() => getSettings().arcadeVolume);
  const [muteArcade, setMuteArcade] = useState(() => getSettings().muteArcade);
  const [arcadeShake, setArcadeShake] = useState(() => getSettings().arcadeShake);
  const activeRunIdRef = useRef(run.id);
  const aliveRef = useRef(true);
  const reqSeqRef = useRef(0);
  const lastAbsorbedRef = useRef(0);
  const finishTimerRef = useRef<number | null>(null);

  // Brief scale bump on the score number: flip a data attribute alongside the
  // value so the CSS animation restarts even when the score jumps by >1.
  const onScore = useCallback((s: number) => {
    setScore(s);
    setScoreBump((b) => !b);
  }, []);

  // Keep the local sound-control mirror in sync with the shared settings store
  // (e.g. if the global Settings panel changes it while the overlay is open).
  useEffect(
    () =>
      subscribeSettings((s) => {
        setArcadeVolume(s.arcadeVolume);
        setMuteArcade(s.muteArcade);
        setArcadeShake(s.arcadeShake);
      }),
    []
  );

  // M toggles the arcade sound from anywhere in the overlay (the shortcut the
  // games themselves advertise); the header button/slider stay the discoverable
  // control. Read the store at press time so the handler needs no deps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "m" && e.key !== "M") return;
      e.preventDefault();
      setSettings({ muteArcade: !getSettings().muteArcade });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Take and hold keyboard focus robustly: blur whatever had focus (e.g. a
  // lingering HUD text input like the chat field, which otherwise swallows game
  // keys via the scene's isTyping guard) and focus our own container.
  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    containerRef.current?.focus();
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      if (finishTimerRef.current !== null) window.clearTimeout(finishTimerRef.current);
    };
  }, []);

  const requestFs = useCallback(() => {
    const el = backdropRef.current;
    if (!el || fullscreenElement() === el) return;
    if (!fullscreenAvailable(el)) {
      wantsFullscreenRef.current = false;
      setFsAvailable(false);
      setFsPending(false);
      return;
    }
    setFsPending(true);
    void requestFullscreen(el)
      .catch(() => {
        // Denied — drop the intent so Resume stops asking. The CSS-maximized
        // overlay already fills the viewport.
        wantsFullscreenRef.current = false;
      })
      .finally(() => setFsPending(false));
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = backdropRef.current;
    if (fullscreenElement() === el) {
      // A deliberate exit — do not read it as a browser-eaten Escape.
      deliberateFsExitRef.current = true;
      wantsFullscreenRef.current = false;
      setFsPending(true);
      void exitFullscreen()
        .catch(() => {
          deliberateFsExitRef.current = false;
        })
        .finally(() => setFsPending(false));
      return;
    }
    wantsFullscreenRef.current = true;
    requestFs();
  }, [requestFs]);

  // F toggles browser fullscreen from anywhere in the overlay — a keypress is
  // still an explicit user gesture, so the no-auto-fullscreen rule holds; the
  // header toggle stays the discoverable control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "f" && e.key !== "F") return;
      e.preventDefault();
      toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen]);

  // We never take browser fullscreen on our own (see the component doc): we
  // only watch the API so the opt-in header toggle stays in sync and the
  // Escape the browser ate on our behalf still pauses the run.
  useEffect(() => {
    const el = backdropRef.current;
    if (el) setFsAvailable(fullscreenAvailable(el));
    const onFsChange = () => {
      const fs = fullscreenElement() === el;
      setIsFullscreen(fs);
      setFsPending(false);
      if (fs) {
        hadFullscreenRef.current = true;
        return;
      }
      const wasOurs = hadFullscreenRef.current;
      hadFullscreenRef.current = false;
      const deliberate = deliberateFsExitRef.current;
      deliberateFsExitRef.current = false;
      if (deliberate || !wasOurs || closingRef.current) return;
      // The browser ate an Escape (or F11) to leave fullscreen — pause, and
      // remember the intent so Resume can hand fullscreen back. Never
      // re-request it from here: this is not a user gesture.
      wantsFullscreenRef.current = true;
      setPhase((p) => (p.k === "playing" ? { k: "paused", reason: "fs-escape" } : p));
      setMenuIndex(0);
    };
    const unsubscribe = subscribeFullscreen(onFsChange);
    return () => {
      unsubscribe();
      // Leaving the arcade: drop fullscreen if we still own it.
      if (fullscreenElement() === el) void exitFullscreen().catch(() => {});
    };
  }, []);

  /** Quit: fade out, drop fullscreen, then hand control back to the parent. */
  const beginClose = useCallback(() => {
    if (closingRef.current) return;
    // Set before any teardown so the resulting fullscreenchange cannot
    // resurrect a panel.
    closingRef.current = true;
    if (finishTimerRef.current !== null) {
      window.clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }
    setPhase({ k: "closing" });
    if (fullscreenElement() === backdropRef.current) {
      void exitFullscreen().catch(() => {});
    }
    closeTimerRef.current = window.setTimeout(onClose, closeFadeMs());
  }, [onClose]);

  const resume = useCallback(() => {
    // Only a pause can resume: `over` is terminal for the run (the game already
    // reported onGameOver) — leaving it for `playing` without a restart would
    // strand a dead game under a live surface.
    setPhase((p) => (p.k === "paused" ? { k: "playing" } : p));
    // Still inside the click/keypress gesture — safe to take fullscreen back.
    if (wantsFullscreenRef.current && fullscreenElement() !== backdropRef.current) {
      requestFs();
    }
  }, [requestFs]);

  const restart = useCallback(() => {
    if (finishTimerRef.current !== null) {
      window.clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }
    setScore(0);
    setScoreBump((b) => !b);
    setNewBest(false);
    setRun((current) => {
      const next = { id: current.id + 1, seed: toSeed(Date.now() + current.id) };
      activeRunIdRef.current = next.id;
      return next;
    });
    setPhase({ k: "playing" });
  }, []);

  const openMenu = useCallback((index: number) => {
    setMenuIndex(index);
    // Never replace a terminal phase with the pause menu: Resume would then "resume" a
    // terminal game that already fired onGameOver (dead screen).
    setPhase((p) =>
      p.k === "closing" || p.k === "finishing" || p.k === "over"
        ? p
        : { k: "paused", reason: "user" }
    );
  }, []);

  const activateMenu = useCallback(
    (index: number) => {
      if (index === 0) resume();
      else if (index === 1) restart();
      else beginClose();
    },
    [resume, restart, beginClose]
  );

  /** Ignore responses older than the newest board already shown. */
  const absorbBoard = useCallback((next: ArcadeLeaderboard, reqId: number) => {
    if (!aliveRef.current || reqId < lastAbsorbedRef.current) return;
    lastAbsorbedRef.current = reqId;
    setBoard(next);
    setBoardError(false);
  }, []);

  // Load the leaderboard for this cabinet. `board === null` with no error flag
  // is the loading state; a rejected fetch flips the flag.
  const refresh = useCallback(() => {
    const reqId = ++reqSeqRef.current;
    fetchLeaderboard(game)
      .then((next) => absorbBoard(next, reqId))
      .catch(() => {
        if (!aliveRef.current || reqId < lastAbsorbedRef.current) return;
        setBoard(null);
        setBoardError(true);
      });
  }, [game, absorbBoard]);
  useEffect(refresh, [refresh]);

  const onGameOver = useCallback(
    (finalScore: number) => {
      const completedRunId = activeRunIdRef.current;
      setLastFinal(finalScore);
      setPhase({ k: "finishing", score: finalScore });

      // Persist immediately. The 450ms terminal hold is presentation only and
      // cannot lose a score if the player restarts or quits during it.
      const reqId = ++reqSeqRef.current;
      submitScore(game, finalScore)
        .then((result) => {
          if (!aliveRef.current) return;
          absorbBoard(result, reqId);
          if (activeRunIdRef.current !== completedRunId) return;
          setNewBest(result.newBest);
          if (result.newBest) bus.emit("arcade-best");
        })
        .catch(() => {
          if (aliveRef.current) refresh();
        });

      if (finishTimerRef.current !== null) window.clearTimeout(finishTimerRef.current);
      finishTimerRef.current = window.setTimeout(() => {
        if (aliveRef.current && activeRunIdRef.current === completedRunId) {
          setPhase({ k: "over", score: finalScore });
        }
        finishTimerRef.current = null;
      }, DEATH_FREEZE_MS);
    },
    [game, absorbBoard, refresh]
  );

  const menuOpen = phase.k === "paused" && phase.reason !== "auto";
  const autoPaused = phase.k === "paused" && phase.reason === "auto";
  const overOpen = phase.k === "over";

  // Keyboard. Capture phase so the game's own handlers never see these keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const swallow = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (phase.k === "closing") return;

      if (e.key === "Escape") {
        swallow();
        if (phase.k === "playing") {
          setMenuIndex(0);
          setPhase({ k: "paused", reason: "user" });
        } else if (menuOpen) {
          resume();
        } else if (phase.k === "finishing" || phase.k === "over") {
          beginClose();
        }
        // auto-pause: ignored — it clears itself on refocus.
        return;
      }

      if (phase.k === "over") {
        if (e.key === "Enter" || e.key === " ") {
          swallow();
          restart();
        }
        return;
      }

      if (!menuOpen) return;
      switch (e.key) {
        case "ArrowUp":
        case "ArrowLeft":
          setMenuIndex((i) => (i + MENU_LENGTH - 1) % MENU_LENGTH);
          break;
        case "ArrowDown":
        case "ArrowRight":
          setMenuIndex((i) => (i + 1) % MENU_LENGTH);
          break;
        case "Enter":
        case " ":
          activateMenu(menuIndex);
          break;
        default:
          return;
      }
      swallow();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [phase, menuOpen, menuIndex, resume, restart, beginClose, activateMenu]);

  // Focus follows the live control: the selected menu item, the Play again
  // button, or the game container while playing.
  useEffect(() => {
    if (menuOpen) {
      menuRefs.current[menuIndex]?.focus();
      return;
    }
    if (overOpen) {
      playAgainRef.current?.focus();
      return;
    }
    if (phase.k === "playing") containerRef.current?.focus();
  }, [phase, menuOpen, overOpen, menuIndex]);

  // Auto-pause when the overlay loses visibility or the window loses focus,
  // and undo it by itself on refocus (never overriding a deliberate pause).
  useEffect(() => {
    const pause = () =>
      setPhase((p) => (p.k === "playing" ? { k: "paused", reason: "auto" } : p));
    const unpause = () =>
      setPhase((p) => (p.k === "paused" && p.reason === "auto" ? { k: "playing" } : p));
    const onVisibility = () => (document.hidden ? pause() : unpause());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", pause);
    window.addEventListener("focus", unpause);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", pause);
      window.removeEventListener("focus", unpause);
    };
  }, []);

  const Game = GAMES[game];
  const rows = board?.top ?? [];
  const best = board?.best ?? null;
  /**
   * Own-row highlight. There is no username in the arcade chunk's session/
   * settings surface, so we use the only signal the payload gives us: the first
   * row whose score equals the caller's personal best is (very likely) them.
   */
  const meIndex = best === null ? -1 : rows.findIndex((r) => r.score === best);

  const menuItems: readonly { label: string; variant: string }[] = [
    { label: "Resume", variant: "arc-btn--primary" },
    { label: "Restart", variant: "arc-btn--blue" },
    { label: "Quit", variant: "arc-btn--danger" },
  ];

  return (
    <div
      className="arcade-backdrop"
      ref={backdropRef}
      data-closing={phase.k === "closing" ? "true" : "false"}
      role="dialog"
      aria-modal="true"
      aria-label={`${label} arcade`}
    >
      <div className="arcade-overlay" ref={containerRef} tabIndex={-1}>
        <header className="arcade-header">
          <div className="arcade-title">
            <span className="arcade-eyebrow">Arcade</span>
            <h2>{label}</h2>
          </div>
          <div className="arcade-tools">
            <div className="arcade-sound" title="Game sound (M)">
              <button
                className="icon-btn arcade-icon-btn"
                onClick={() => setSettings({ muteArcade: !muteArcade })}
                aria-label={muteArcade ? "Unmute arcade sound" : "Mute arcade sound"}
                aria-pressed={muteArcade}
              >
                {muteArcade ? (
                  <VolumeX size={16} aria-hidden="true" />
                ) : (
                  <Volume2 size={16} aria-hidden="true" />
                )}
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
                title="Arcade volume"
                aria-label="Arcade volume"
              />
            </div>
            <button
              className="icon-btn arcade-icon-btn"
              onClick={() => setSettings({ arcadeShake: !arcadeShake })}
              title="Screen shake"
              aria-label={arcadeShake ? "Turn screen shake off" : "Turn screen shake on"}
              aria-pressed={arcadeShake}
            >
              {arcadeShake ? (
                <Vibrate size={16} aria-hidden="true" />
              ) : (
                <VibrateOff size={16} aria-hidden="true" />
              )}
            </button>
            <button
              className="icon-btn arcade-icon-btn"
              onClick={toggleFullscreen}
              disabled={fsPending || !fsAvailable}
              title={
                fsAvailable
                  ? isFullscreen
                    ? "Exit fullscreen"
                    : "Enter fullscreen"
                  : "Fullscreen is unavailable in this browser or embedded view"
              }
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              aria-pressed={isFullscreen}
            >
              {isFullscreen ? (
                <Minimize size={16} aria-hidden="true" />
              ) : (
                <Maximize size={16} aria-hidden="true" />
              )}
            </button>
            <button
              className="arc-btn arc-btn--ghost arcade-quit"
              // The run is already over on the game-over card — there is
              // nothing to lose, so header Quit closes directly instead of
              // raising the pause menu (whose Resume has nothing to resume).
              onClick={() =>
                phase.k === "finishing" || phase.k === "over" ? beginClose() : openMenu(2)
              }
              aria-label="Quit arcade"
            >
              Quit <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="arcade-body">
          <div className="arcade-stage">
            <div className="arcade-scorebar">
              <div className="arcade-scorecell">
                <span className="arcade-scorelabel">Score</span>
                <span
                  className="arcade-scorenum"
                  data-bump={scoreBump ? "b" : "a"}
                  aria-hidden="true"
                >
                  {score}
                </span>
              </div>
              <div className="arcade-scorecell arcade-scorecell--best">
                <span className="arcade-scorelabel">Best</span>
                <span className="arcade-scorenum arcade-scorenum--best">{best ?? "—"}</span>
              </div>
              <span className="arcade-sr" aria-live="polite">
                Score {score}
              </span>
            </div>

            <div className="arcade-surface">
              {/* The monotonic id remounts even for same-millisecond restarts. */}
              <Game
                key={run.id}
                seed={run.seed}
                paused={phase.k !== "playing" && phase.k !== "finishing"}
                shake={arcadeShake}
                onScore={onScore}
                onGameOver={onGameOver}
                bestScore={best}
              />

              {/* Panels stay mounted so their exit can animate; `data-open`
                  drives visibility. */}
              <div
                className="arcade-panel arcade-panel--auto"
                data-panel="auto"
                data-open={autoPaused ? "true" : "false"}
                onClick={() =>
                  setPhase((p) =>
                    p.k === "paused" && p.reason === "auto" ? { k: "playing" } : p
                  )
                }
              >
                <p className="arcade-autotext">Paused · click to resume</p>
              </div>

              <div
                className="arcade-panel arcade-panel--menu"
                data-panel="pause"
                data-open={menuOpen ? "true" : "false"}
              >
                <div className="arcade-card arcade-card--pause" role="menu" aria-label="Paused">
                  <h3 className="arcade-card-title">Paused</h3>
                  <div className="arcade-menu">
                    {menuItems.map((item, i) => (
                      <button
                        key={item.label}
                        ref={(el) => {
                          menuRefs.current[i] = el;
                        }}
                        role="menuitem"
                        className={`arc-btn arc-btn--menu ${item.variant}`}
                        aria-current={menuIndex === i ? "true" : undefined}
                        onPointerEnter={() => setMenuIndex(i)}
                        onClick={() => activateMenu(i)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <p className="arcade-hint">Esc to resume</p>
                </div>
              </div>

              <div
                className="arcade-panel arcade-panel--over"
                data-panel="over"
                data-open={overOpen ? "true" : "false"}
              >
                <div className="arcade-card arcade-card--over">
                  <h3 className="arcade-card-title">Game over</h3>
                  <p className="arcade-final">{lastFinal}</p>
                  {newBest && <p className="arcade-newbest">New best!</p>}
                  <div className="arcade-card-row">
                    <button
                      ref={playAgainRef}
                      className="arc-btn arc-btn--primary"
                      onClick={restart}
                    >
                      Play again
                    </button>
                    <button className="arc-btn arc-btn--ghost" onClick={beginClose}>
                      Quit
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <aside className="arcade-leaderboard" aria-label="Leaderboard">
            <h3 className="arcade-lb-title">Leaderboard</h3>
            <div className="arcade-yourbest">
              <span className="arcade-yourbest-label">Your best</span>
              <span className="arcade-yourbest-num">{best ?? "—"}</span>
            </div>
            {boardError ? (
              <p className="arcade-lb-note">Scores unavailable</p>
            ) : board === null ? (
              <div className="arcade-lb-skeleton" aria-hidden="true">
                <span className="arcade-skel" />
                <span className="arcade-skel" />
                <span className="arcade-skel" />
              </div>
            ) : rows.length === 0 ? (
              <p className="arcade-lb-note">No scores yet — set the pace.</p>
            ) : (
              <ol className="arcade-rows">
                {rows.map((row, i) => (
                  <li
                    key={`${row.username}-${i}`}
                    className={`arcade-row arcade-row--r${i < 3 ? i + 1 : "n"}${
                      i === meIndex ? " arcade-row--me" : ""
                    }`}
                    style={{ "--i": i } as CSSProperties}
                  >
                    <span className="arcade-rank">{i + 1}</span>
                    <span className="arcade-name">
                      {row.username}
                      {i === meIndex && <span className="arcade-you">you</span>}
                    </span>
                    <span className="arcade-pts">{row.score}</span>
                  </li>
                ))}
              </ol>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
