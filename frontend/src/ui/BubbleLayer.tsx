import { useEffect, useRef, useState } from "react";
import { CameraOff } from "lucide-react";
import { bus } from "../game/eventBus";
import { onLocalStream, startCamera, stopCamera } from "../media/localMedia";
import { roomVideo, type RoomTrack } from "../media/livekit";
import { USE_MOCK } from "../net/auth";

interface ScreenPos {
  id: string;
  self: boolean;
  sx: number;
  sy: number;
}

/**
 * Webcam bubbles floating above seated avatars (Gather-style).
 *  - Real mode: one bubble per LiveKit room participant (incl. you), each video
 *    track anchored to that avatar's on-screen position.
 *  - Mock mode: your local camera in your own bubble (no server needed).
 */
export default function BubbleLayer() {
  const [positions, setPositions] = useState<ScreenPos[]>([]);

  useEffect(() => {
    const off = bus.on("positions", (p: { players: ScreenPos[] }) =>
      setPositions(p.players)
    );
    return () => {
      off();
    };
  }, []);

  return USE_MOCK ? (
    <MockBubble positions={positions} />
  ) : (
    <LiveBubbles positions={positions} />
  );
}

/* --------- Real: LiveKit room tracks anchored to avatars --------- */
function LiveBubbles({ positions }: { positions: ScreenPos[] }) {
  const [tracks, setTracks] = useState<RoomTrack[]>([]);
  useEffect(() => {
    const off = roomVideo.onTracks(setTracks);
    return () => {
      off();
    };
  }, []);

  return (
    <>
      {tracks.map((t) => {
        const pos = positions.find((p) => p.id === t.identity);
        if (!pos) return null;
        return (
          <VideoBubble
            key={t.identity}
            track={t.track}
            left={pos.sx}
            top={pos.sy - 70}
            label={t.self ? "You" : ""}
          />
        );
      })}
    </>
  );
}

function VideoBubble({
  track,
  left,
  top,
  label,
}: {
  track: MediaStreamTrack;
  left: number;
  top: number;
  label: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = new MediaStream([track]);
  }, [track]);
  return (
    <div className="bubble" style={{ left, top }}>
      <div className="bubble-frame">
        <video ref={ref} autoPlay playsInline muted={!!label} className="bubble-media" />
      </div>
      {label && <div className="bubble-name">{label}</div>}
    </div>
  );
}

/* --------- Mock: local camera preview only --------- */
function MockBubble({ positions }: { positions: ScreenPos[] }) {
  const [seated, setSeated] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const self = positions.find((p) => p.self);

  useEffect(() => {
    const offSat = bus.on("sat", async () => {
      setSeated(true);
      await startCamera(true, true);
    });
    const offStood = bus.on("stood", () => {
      setSeated(false);
      stopCamera();
    });
    const offStream = onLocalStream(setStream);
    return () => {
      offSat();
      offStood();
      offStream();
    };
  }, []);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  if (!seated || !self) return null;
  return (
    <div className="bubble" style={{ left: self.sx, top: self.sy - 70 }}>
      <div className="bubble-frame">
        {stream ? (
          <video ref={videoRef} autoPlay playsInline muted className="bubble-media" />
        ) : (
          <div className="bubble-fallback" aria-label="Camera off" role="img">
            <CameraOff size={22} aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="bubble-name">You</div>
    </div>
  );
}
