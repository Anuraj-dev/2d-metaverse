import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, ScreenShare } from "lucide-react";
import { bus } from "../game/eventBus";
import { setMic, setCam } from "../media/mediaControls";
import { getMediaPrefs, subscribeMediaPrefs } from "../media/mediaPrefs";
import { micToastText, camToastText } from "../game/controlBar";
import Settings from "./Settings";
import MicMeter from "./MicMeter";

const TOAST_MS = 1600;

/**
 * The single, always-visible control bar (PRD 20). It sits bottom-center on every
 * surface — walking, seated, and above the lazy meeting/arcade overlays — replacing
 * the old seated-only `MediaControls` and the meeting overlay's duplicate mic/cam
 * pair. Mic/cam always drive the live media manager (`media/mediaControls`), which
 * keeps one mute sticky across walk<->meeting. Each toggle swaps the lucide icon,
 * emits a bus event for the sound mixer's blip, and shows a transient toast that is
 * announced politely for screen readers. A screen-share slot is designed in but
 * disabled — its behaviour lands in PRD 23. Settings lives in the bar.
 */
export default function ControlBar() {
  const [prefs, setPrefs] = useState(getMediaPrefs());
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => subscribeMediaPrefs(() => setPrefs(getMediaPrefs())), []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const flash = (text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), TOAST_MS);
  };

  const onMic = () => {
    const on = !prefs.micOn;
    setMic(on);
    bus.emit("mic-toggle", { on });
    flash(micToastText(on));
  };
  const onCam = () => {
    const on = !prefs.camOn;
    setCam(on);
    bus.emit("cam-toggle", { on });
    flash(camToastText(on));
  };

  return (
    <div className="control-bar">
      <button
        type="button"
        className={`icon-btn control-btn ${prefs.micOn ? "on" : "off"}`}
        onClick={onMic}
        aria-label={prefs.micOn ? "Mute microphone" : "Unmute microphone"}
        aria-pressed={!prefs.micOn}
      >
        {prefs.micOn ? (
          <Mic size={20} aria-hidden="true" />
        ) : (
          <MicOff size={20} aria-hidden="true" />
        )}
        {/* Live input-level meter, only while the mic is on. */}
        {prefs.micOn && <MicMeter />}
      </button>

      <button
        type="button"
        className={`icon-btn control-btn ${prefs.camOn ? "on" : "off"}`}
        onClick={onCam}
        aria-label={prefs.camOn ? "Turn camera off" : "Turn camera on"}
        aria-pressed={!prefs.camOn}
      >
        {prefs.camOn ? (
          <Video size={20} aria-hidden="true" />
        ) : (
          <VideoOff size={20} aria-hidden="true" />
        )}
      </button>

      {/* Screen-share slot: layout only. Behaviour lands in PRD 23. */}
      <button
        type="button"
        className="icon-btn control-btn control-share"
        aria-label="Share screen (coming soon)"
        disabled
      >
        <ScreenShare size={20} aria-hidden="true" />
      </button>

      <span className="control-sep" aria-hidden="true" />
      <Settings />

      <div className="control-toast" role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}
