import { useEffect, useRef, useState } from "react";
import { bus } from "../game/eventBus";
import { stageVideo } from "../media/livekit";
import type { RoomTrack } from "../media/livekit";
import { sharedNet } from "../net/shared";

function VideoTrackEl({ track }: { track: MediaStreamTrack }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = new MediaStream([track]);
  }, [track]);
  return <video ref={ref} autoPlay playsInline className="stage-video-el" />;
}

export default function StageScreen() {
  const [tracks, setTracks] = useState<RoomTrack[]>([]);
  const [nearPresenter, setNearPresenter] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const offNear  = bus.on("near-presenter-slot",  () => setNearPresenter(true));
    const offLeave = bus.on("leave-presenter-slot", () => setNearPresenter(false));
    const offTracks = stageVideo.onTracks(setTracks);
    return () => {
      offNear();
      offLeave();
      offTracks();
    };
  }, []);

  async function handleGoLive() {
    setError(null);
    const net = sharedNet();
    try {
      await stageVideo.joinAsPresenter("1", net.selfId, keyInput);
      setIsLive(true);
      setShowKeyInput(false);
    } catch {
      setError("Invalid presenter key or connection failed");
    }
  }

  async function handleStopLive() {
    await stageVideo.leave();
    setIsLive(false);
    setKeyInput("");
  }

  const remoteTracks = tracks.filter((t) => !t.self);
  const selfTrack = tracks.find((t) => t.self);

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

      {nearPresenter && !isLive && (
        <div className="stage-presenter-panel">
          {showKeyInput ? (
            <div className="stage-key-form">
              <input
                type="password"
                placeholder="Presenter key"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleGoLive()}
                className="stage-key-input"
                autoFocus
              />
              <button className="stage-btn-go" onClick={() => void handleGoLive()}>
                Go Live
              </button>
              <button className="stage-btn-cancel" onClick={() => setShowKeyInput(false)}>
                Cancel
              </button>
              {error && <span className="stage-error">{error}</span>}
            </div>
          ) : (
            <button className="stage-btn-go" onClick={() => setShowKeyInput(true)}>
              🎙 Go Live
            </button>
          )}
        </div>
      )}

      {isLive && (
        <div className="stage-presenter-panel">
          <button className="stage-btn-stop" onClick={() => void handleStopLive()}>
            ⏹ Stop Broadcast
          </button>
        </div>
      )}
    </>
  );
}
