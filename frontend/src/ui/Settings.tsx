import { useEffect, useState, lazy, Suspense } from "react";
import { Bell, Maximize, Settings as SettingsIcon, ShieldCheck } from "lucide-react";
import { bus } from "../game/eventBus";
import {
  getSettings,
  setSettings,
  subscribeSettings,
  type Settings as S,
} from "./settings";
import type { ReducedMotionSetting } from "../game/reducedMotion";
import {
  isModerator,
  nextProbeState,
  shouldProbe,
  type ProbeState,
} from "../game/modPanel";
import { probeModerator } from "../net/moderation";

// The moderator dashboard is a lazy chunk: its code never enters the entry
// bundle, and it only loads for an allowlisted moderator who opens it.
const ModPanel = lazy(() => import("./mod/ModPanel"));

// Session-scoped probe cache: moderator status is discovered once (first Settings
// open) by probing GET /mod/reports, then reused for the rest of the session.
let cachedProbe: ProbeState = "unknown";

// Narrow the <select> value to the union without an assertion; unknown values
// (never emitted by the fixed <option> set) fall back to following the OS.
function toReducedMotion(value: string): ReducedMotionSetting {
  return value === "on" || value === "off" ? value : "system";
}

export default function Settings() {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<S>(getSettings());
  const [perm, setPerm] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );
  const [probe, setProbe] = useState<ProbeState>(cachedProbe);
  const [modOpen, setModOpen] = useState(false);

  useEffect(() => subscribeSettings(setS), []);

  // On the first Settings open, probe moderator visibility once. 200 ⇒ show the
  // Moderation button; 404 ⇒ never render it (matches the server's 404-hiding
  // design). An inconclusive probe stays `unknown` and retries next open.
  useEffect(() => {
    if (!open || !shouldProbe(cachedProbe)) return;
    // Guard re-probing via the module-level cache (not React state) so the effect
    // body never calls setState synchronously; the answer is committed in .then.
    cachedProbe = nextProbeState(cachedProbe, "check");
    let active = true;
    void probeModerator().then((result) => {
      cachedProbe = nextProbeState(
        cachedProbe,
        result === "granted" ? "granted" : result === "denied" ? "denied" : "reset",
      );
      if (active) setProbe(cachedProbe);
    });
    return () => {
      active = false;
    };
  }, [open]);

  // Mutually-exclusive HUD overlays (issue #79): the Settings panel and the
  // fullscreen campus map must never stack. Opening the map closes Settings…
  useEffect(() => bus.on("map-open", () => setOpen(false)), []);
  // …and opening Settings closes the map. Emit only on the open transition so a
  // close (incl. the one the map triggers) can't ping-pong back.
  useEffect(() => {
    if (open) bus.emit("settings-open");
  }, [open]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  const enableNotifs = async () => {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setPerm(p);
  };

  return (
    <div className="settings">
      <button
        className="icon-btn"
        aria-label="Settings"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <SettingsIcon size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="settings-panel">
          <h4>Settings</h4>
          <label className="set-row">
            <span>Master</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(s.masterVolume * 100)}
              onChange={(e) =>
                setSettings({ masterVolume: Number(e.target.value) / 100 })
              }
            />
          </label>
          <label className="set-row">
            <span>Music</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(s.musicVolume * 100)}
              onChange={(e) =>
                setSettings({ musicVolume: Number(e.target.value) / 100 })
              }
            />
          </label>
          <label className="set-row">
            <span>Effects</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(s.sfxVolume * 100)}
              onChange={(e) =>
                setSettings({ sfxVolume: Number(e.target.value) / 100 })
              }
            />
          </label>
          <label className="set-row">
            <span>Ambient</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(s.ambientVolume * 100)}
              onChange={(e) =>
                setSettings({ ambientVolume: Number(e.target.value) / 100 })
              }
            />
          </label>
          <label className="set-row">
            <span>Mute all</span>
            <input
              type="checkbox"
              checked={s.muted}
              onChange={(e) => setSettings({ muted: e.target.checked })}
            />
          </label>
          <label className="set-row">
            <span>Mute game sounds</span>
            <input
              type="checkbox"
              checked={s.muteSfx}
              onChange={(e) => setSettings({ muteSfx: e.target.checked })}
            />
          </label>
          <label className="set-row">
            <span>Chat chime</span>
            <input
              type="checkbox"
              checked={s.notifySound}
              onChange={(e) => setSettings({ notifySound: e.target.checked })}
            />
          </label>
          <label className="set-row">
            <span>Tab alerts</span>
            <input
              type="checkbox"
              checked={s.tabFlash}
              onChange={(e) => setSettings({ tabFlash: e.target.checked })}
            />
          </label>
          <label className="set-row">
            <span>Reduce motion</span>
            <select
              value={s.reducedMotion}
              onChange={(e) =>
                setSettings({ reducedMotion: toReducedMotion(e.target.value) })
              }
            >
              <option value="system">System</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
          <div className="set-actions">
            <button onClick={toggleFullscreen}>
              <Maximize size={14} aria-hidden="true" /> Fullscreen
            </button>
            {perm !== "granted" && (
              <button onClick={enableNotifs}>
                <Bell size={14} aria-hidden="true" /> Desktop alerts
              </button>
            )}
            {isModerator(probe) && (
              <button onClick={() => setModOpen(true)}>
                <ShieldCheck size={14} aria-hidden="true" /> Moderation
              </button>
            )}
          </div>
          <div className="set-version">build {__APP_SHA__.slice(0, 7)}</div>
        </div>
      )}
      {modOpen && (
        <Suspense fallback={null}>
          <ModPanel onClose={() => setModOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
