import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CircleStop, Radio } from "lucide-react";
import { bus } from "../game/eventBus";
import { stageVideo } from "../media/livekit";
import type { RoomTrack } from "../media/livekit";
import { isPublishFailure, isPublished } from "../media/publicationState";

function VideoTrackEl({ track }: { track: MediaStreamTrack }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = new MediaStream([track]);
  }, [track]);
  return <video ref={ref} autoPlay playsInline className="stage-video-el" />;
}

/**
 * Stage broadcast HUD (PRD 17):
 *  - one Go Live prompt after the player stands still on the presenter platform;
 *  - a persistent LIVE / NOT LIVE indicator;
 *  - the remote video grid. Audio starts with Go Live; the global camera control
 *    can add or remove video from that same broadcast.
 */
export default function StageScreen() {
  const [tracks, setTracks] = useState<RoomTrack[]>([]);
  const [nearPresenter, setNearPresenter] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  // The single truth for LIVE: the transport's CONFIRMED publication
  // status (PRD 25.7). The stage can never render LIVE off an optimistic guess —
  // a failed/denied publish leaves this non-`live`, so the indicator stays down.
  const pubStatus = useSyncExternalStore(
    stageVideo.onPublicationStatus,
    stageVideo.getPublicationStatus,
    () => "off" as const,
  );

  useEffect(() => {
    const offNear = bus.on("near-presenter-slot", () => setNearPresenter(true));
    const offLeave = bus.on("leave-presenter-slot", () => setNearPresenter(false));
    const offPromptShow = bus.on("stage-prompt-show", () => setPromptOpen(true));
    const offPromptHide = bus.on("stage-prompt-hide", () => setPromptOpen(false));
    const offOnAir = bus.on("stage-on-air", () => setPromptOpen(false));
    const offTracks = stageVideo.onTracks(setTracks);
    return () => {
      offNear();
      offLeave();
      offPromptShow();
      offPromptHide();
      offOnAir();
      offTracks();
    };
  }, []);

  const remoteTracks = tracks.filter((t) => !t.self);
  const selfTrack = tracks.find((t) => t.self);
  // Confirmed live means the publish token is active. A self video tile appears
  // only when the camera control is on and the transport surfaces its track.
  const broadcasting = isPublished(pubStatus);
  // A failed/denied publish re-opens this same prompt through WorldScene.
  const publishFailed = isPublishFailure(pubStatus);

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

      {selfTrack && broadcasting && (
        <div className="stage-self-preview">
          <VideoTrackEl track={selfTrack.track} />
          <span className="stage-self-label">You (live)</span>
        </div>
      )}

      {(nearPresenter || broadcasting) && (
        <div
          className={`stage-on-air-indicator ${broadcasting ? "is-live" : "is-off"}`}
          role="status"
          aria-live="polite"
        >
          <span className="stage-on-air-dot" aria-hidden="true" />
          {broadcasting ? "LIVE" : "NOT LIVE"}
        </div>
      )}

      {promptOpen && !broadcasting && (
        <div className="stage-presenter-panel stage-onair-prompt">
          <div className="stage-onair-title">Go live?</div>
          <div className="stage-onair-sub">
            Your microphone broadcasts to everyone. Turn on your camera anytime to add video.
          </div>
          <div className="stage-onair-actions">
            <button className="stage-btn-go" onClick={() => bus.emit("stage-confirm")}>
              <Radio size={16} aria-hidden="true" /> Go Live
            </button>
            <button className="stage-btn-cancel" onClick={() => bus.emit("stage-decline")}>
              Not now
            </button>
          </div>
          {publishFailed && (
            <span className="stage-error" role="alert">
              Couldn't start the live broadcast. Check microphone access and try again.
            </span>
          )}
        </div>
      )}

      {broadcasting && (
        <div className="stage-presenter-panel">
          <button className="stage-btn-stop" onClick={() => bus.emit("stage-stop")}>
            <CircleStop size={16} aria-hidden="true" /> Stop Live
          </button>
        </div>
      )}
    </>
  );
}
