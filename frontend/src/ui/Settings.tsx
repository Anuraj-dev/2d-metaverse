import { useEffect, useState } from "react";
import { Bell, Maximize, Settings as SettingsIcon } from "lucide-react";
import { bus } from "../game/eventBus";
import {
  getSettings,
  setSettings,
  subscribeSettings,
  type Settings as S,
} from "./settings";

export default function Settings() {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<S>(getSettings());
  const [perm, setPerm] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );

  useEffect(() => subscribeSettings(setS), []);

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
          <div className="set-actions">
            <button onClick={toggleFullscreen}>
              <Maximize size={14} aria-hidden="true" /> Fullscreen
            </button>
            {perm !== "granted" && (
              <button onClick={enableNotifs}>
                <Bell size={14} aria-hidden="true" /> Desktop alerts
              </button>
            )}
          </div>
          <div className="set-version">build {__APP_SHA__.slice(0, 7)}</div>
        </div>
      )}
    </div>
  );
}
