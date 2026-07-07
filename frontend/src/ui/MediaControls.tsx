import { useEffect, useState } from "react";
import { Mic, MicOff, Video, VideoOff } from "lucide-react";
import { bus } from "../game/eventBus";
import { setCamEnabled, setMicEnabled } from "../media/localMedia";
import { roomVideo } from "../media/livekit";
import { USE_MOCK } from "../net/auth";

/** Mic/cam toggles + leave-seat, shown only while seated in a room. */
export default function MediaControls() {
  const [seated, setSeated] = useState(false);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);

  useEffect(() => {
    const offSat = bus.on("sat", () => {
      setSeated(true);
      setMic(true);
      setCam(true);
    });
    const offStood = bus.on("stood", () => setSeated(false));
    return () => {
      offSat();
      offStood();
    };
  }, []);

  if (!seated) return null;

  const applyMic = (on: boolean) =>
    USE_MOCK ? setMicEnabled(on) : roomVideo.setMicEnabled(on);
  const applyCam = (on: boolean) =>
    USE_MOCK ? setCamEnabled(on) : roomVideo.setCamEnabled(on);

  const toggleMic = () => {
    const v = !mic;
    setMic(v);
    applyMic(v);
  };
  const toggleCam = () => {
    const v = !cam;
    setCam(v);
    applyCam(v);
  };

  return (
    <div className="media-controls">
      <button
        className={mic ? "on" : "off"}
        onClick={toggleMic}
        aria-label={mic ? "Mute microphone" : "Unmute microphone"}
        aria-pressed={!mic}
      >
        {mic ? <Mic size={20} aria-hidden="true" /> : <MicOff size={20} aria-hidden="true" />}
      </button>
      <button
        className={cam ? "on" : "off"}
        onClick={toggleCam}
        aria-label={cam ? "Turn camera off" : "Turn camera on"}
        aria-pressed={!cam}
      >
        {cam ? <Video size={20} aria-hidden="true" /> : <VideoOff size={20} aria-hidden="true" />}
      </button>
      <button className="leave" onClick={() => bus.emit("do-stand")}>
        Leave seat
      </button>
    </div>
  );
}
