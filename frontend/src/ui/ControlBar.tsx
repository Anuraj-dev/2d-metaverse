import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, MicOff, Video, VideoOff, ScreenShare, ScreenShareOff } from "lucide-react";
import { bus } from "../game/eventBus";
import {
  setMic,
  setCam,
  setScreenShare,
  isScreenSharing,
  subscribeScreenShare,
} from "../media/mediaControls";
import { getMediaPrefs, setMediaPrefs, subscribeMediaPrefs } from "../media/mediaPrefs";
import { outcomeNeedsAttention, type MediaOutcome } from "../media/publicationState";
import { micToastText, camToastText, mediaFailureText } from "../game/controlBar";
import { getOperationalReporter } from "../operationalReport";
import { getAnalyticsEmitter } from "../analytics";
import { mediaEnableEvent, mediaEnableOutcome } from "../game/reliability";
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
 * announced politely for screen readers. The screen-share button (PRD 23) is
 * enabled only while in a meeting and publishes to the meeting room. Settings
 * lives in the bar.
 */
export default function ControlBar() {
  const [prefs, setPrefs] = useState(getMediaPrefs());
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);
  // Screen share is only meaningful inside a meeting; the button greys out
  // otherwise. `meeting-grid-visible`/`hidden` bracket THIS client's meeting.
  const [inMeeting, setInMeeting] = useState(false);
  const sharing = useSyncExternalStore(subscribeScreenShare, isScreenSharing, () => false);

  useEffect(() => subscribeMediaPrefs(() => setPrefs(getMediaPrefs())), []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  useEffect(() => {
    const offShow = bus.on("meeting-grid-visible", () => setInMeeting(true));
    const offHide = bus.on("meeting-grid-hidden", () => setInMeeting(false));
    return () => {
      offShow();
      offHide();
    };
  }, []);

  const flash = (text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), TOAST_MS);
  };

  // Toggle a device optimistically (immediate icon flip + blip), then await the
  // transport's confirmed outcome (PRD 25.7): if the publish was denied /
  // unavailable / failed, revert the preference so the control stays truthful and
  // announce the bounded reason instead of the optimistic "on" toast.
  const toggleDevice = (
    device: "mic" | "cam",
    on: boolean,
    apply: (on: boolean) => Promise<MediaOutcome>,
    okText: string,
  ) => {
    bus.emit(device === "mic" ? "mic-toggle" : "cam-toggle", { on });
    flash(okText);
    void apply(on).then(({ status }) => {
      // Only an attempted turn-on carries a meaningful outcome; a mute always
      // succeeds. Record the media enable outcome (success or a bounded failure)
      // for the pilot reliability baseline (PRD 25.10).
      if (on) {
        const kind = device === "mic" ? "mic" : "camera";
        getAnalyticsEmitter().emit(mediaEnableEvent(kind, mediaEnableOutcome(status)));
      }
      if (on && outcomeNeedsAttention(status)) {
        setMediaPrefs(device === "mic" ? { micOn: false } : { camOn: false });
        flash(mediaFailureText(device, status));
        // `status` is narrowed to a bounded MediaFailure here — report it once.
        getOperationalReporter().reportMediaPublishFailure(status);
      }
    });
  };

  const onMic = () => toggleDevice("mic", !prefs.micOn, setMic, micToastText(!prefs.micOn));
  const onCam = () => toggleDevice("cam", !prefs.camOn, setCam, camToastText(!prefs.camOn));
  const onShare = () => {
    const on = !sharing;
    setScreenShare(on);
    // Emit the intent (drives the sound blip + the e2e "publish attempted" hook)
    // regardless of whether the transport ultimately publishes; the button's
    // sharing state reflects the actual published track via the subscription.
    bus.emit(on ? "screen-share-on" : "screen-share-off");
    flash(on ? "Sharing your screen" : "Stopped sharing");
  };

  return (
    <div className="control-bar" data-dialog-keep-live>
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

      {/* Screen share (PRD 23): enabled only inside a meeting; reflects sharing. */}
      <button
        type="button"
        className={`icon-btn control-btn control-share ${sharing ? "sharing" : ""}`}
        onClick={onShare}
        disabled={!inMeeting}
        aria-pressed={sharing}
        aria-label={
          !inMeeting
            ? "Share screen (available in meetings)"
            : sharing
              ? "Stop sharing your screen"
              : "Share your screen"
        }
      >
        {sharing ? (
          <ScreenShareOff size={20} aria-hidden="true" />
        ) : (
          <ScreenShare size={20} aria-hidden="true" />
        )}
      </button>

      <span className="control-sep" aria-hidden="true" />
      <Settings />

      <div className="control-toast" role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}
