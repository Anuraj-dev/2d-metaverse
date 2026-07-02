import { useEffect, useState } from "react";
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
        title="Settings"
        onClick={() => setOpen((o) => !o)}
      >
        ⚙️
      </button>
      {open && (
        <div className="settings-panel">
          <h4>Settings</h4>
          <label className="set-row">
            <span>Volume</span>
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
            <button onClick={toggleFullscreen}>⛶ Fullscreen</button>
            {perm !== "granted" && (
              <button onClick={enableNotifs}>🔔 Desktop alerts</button>
            )}
          </div>
          <div className="set-version">build {__APP_SHA__.slice(0, 7)}</div>
        </div>
      )}
    </div>
  );
}
