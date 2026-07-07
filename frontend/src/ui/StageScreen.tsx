import { useEffect, useRef, useState } from "react";
import { CircleStop, Mic, Video } from "lucide-react";
import { bus } from "../game/eventBus";
import { stageVideo } from "../media/livekit";
import type { RoomTrack } from "../media/livekit";
import { sharedNet } from "../net/shared";

const SPACE_ID = "1";

function VideoTrackEl({ track }: { track: MediaStreamTrack }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = new MediaStream([track]);
  }, [track]);
  return <video ref={ref} autoPlay playsInline className="stage-video-el" />;
}

/**
 * Stage broadcast HUD (PRD 17):
 *  - the on-air confirm prompt (raised by the pure on-air machine after the player
 *    stands still on the stage for ~2s) and the persistent ON AIR indicator;
 *  - the remote broadcast video grid + the keyless "Go Live" video control at the
 *    presenter podium (the presenter key was removed — publish is gated by the
 *    server validating the player's position).
 */
export default function StageScreen() {
  const [tracks, setTracks] = useState<RoomTrack[]>([]);
  const [nearPresenter, setNearPresenter] = useState(false);
  const [isLive, setIsLive] = useState(false); // "Go Live" video broadcast
  const [voiceOnAir, setVoiceOnAir] = useState(false); // stage voice broadcast
  const [promptOpen, setPromptOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const offNear = bus.on("near-presenter-slot", () => setNearPresenter(true));
    const offLeave = bus.on("leave-presenter-slot", () => setNearPresenter(false));
    const offPromptShow = bus.on("stage-prompt-show", () => setPromptOpen(true));
    const offPromptHide = bus.on("stage-prompt-hide", () => setPromptOpen(false));
    const offOnAir = bus.on("stage-on-air", () => {
      setVoiceOnAir(true);
      setPromptOpen(false);
    });
    const offOffAir = bus.on("stage-off-air", () => setVoiceOnAir(false));
    const offTracks = stageVideo.onTracks(setTracks);
    return () => {
      offNear();
      offLeave();
      offPromptShow();
      offPromptHide();
      offOnAir();
      offOffAir();
      offTracks();
    };
  }, []);

  async function handleGoLive() {
    setError(null);
    try {
      await stageVideo.goLive(SPACE_ID, sharedNet().selfId);
      setIsLive(true);
    } catch {
      setError("Broadcast failed — are you standing on the stage?");
    }
  }

  async function handleStopLive() {
    await stageVideo.goOffAir(SPACE_ID, sharedNet().selfId);
    setIsLive(false);
  }

  const remoteTracks = tracks.filter((t) => !t.self);
  const selfTrack = tracks.find((t) => t.self);
  const broadcasting = voiceOnAir || isLive;

  return (
    <>
      {remoteTracks.length > 0 && (
        <div className="stage-screen">
          <div className="stage-screen-header">
            <span className="stage-screen-badge">LIVE</span>
            Stage Broadcast
          </div>
          <div className="stage-video-grid">
            {remoteTracks.map((t) => (
              <VideoTrackEl key={t.identity} track={t.track} />
            ))}
          </div>
        </div>
      )}

      {selfTrack && isLive && (
        <div className="stage-self-preview">
          <VideoTrackEl track={selfTrack.track} />
          <span className="stage-self-label">You (live)</span>
        </div>
      )}

      {broadcasting && (
        <div className="stage-on-air-indicator" role="status">
          <span className="stage-on-air-dot" aria-hidden="true" />
          ON AIR
        </div>
      )}

      {promptOpen && !broadcasting && (
        <div className="stage-presenter-panel stage-onair-prompt">
          <div className="stage-onair-title">Go on air?</div>
          <div className="stage-onair-sub">Your voice broadcasts to everyone in the space.</div>
          <div className="stage-onair-actions">
            <button className="stage-btn-go" onClick={() => bus.emit("stage-confirm")}>
              <Mic size={16} aria-hidden="true" /> Go on air
            </button>
            <button className="stage-btn-cancel" onClick={() => bus.emit("stage-decline")}>
              Not now
            </button>
          </div>
        </div>
      )}

      {nearPresenter && !isLive && (
        <div className="stage-presenter-panel">
          <button className="stage-btn-go" onClick={() => void handleGoLive()}>
            <Video size={16} aria-hidden="true" /> Go Live (video)
          </button>
          {error && <span className="stage-error">{error}</span>}
        </div>
      )}

      {isLive && (
        <div className="stage-presenter-panel">
          <button className="stage-btn-stop" onClick={() => void handleStopLive()}>
            <CircleStop size={16} aria-hidden="true" /> Stop Broadcast
          </button>
        </div>
      )}
    </>
  );
}
