/**
 * The Meet-style grid (PRD 10), built on LiveKit's React components
 * (GridLayout/ParticipantTile/VideoTrack) rather than raw <video> elements —
 * they provide responsive tile arrangement, active-speaker emphasis and
 * screen-share tiles. The custom tile content adds username nameplates and
 * the camera-off state: the participant's in-game pixel sprite.
 *
 * Tiles derive from BOTH sources:
 *  - the server-sent meeting roster (participants + names) — always present,
 *    so the grid renders even when media is unavailable (roster fallback);
 *  - the existing per-room LiveKit Room (media/livekit.ts roomVideo), joined
 *    when the player sat down — the meeting UPGRADES that connection to the
 *    grid; no new token semantics.
 */
import { useSyncExternalStore } from "react";
import {
  GridLayout,
  ParticipantTile,
  RoomContext,
  VideoTrack,
  isTrackReference,
  useEnsureTrackRef,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { motion } from "motion/react";
import type { MeetingParticipant } from "@metaverse/shared";
import { roomVideo } from "../media/livekit";
import PixelAvatar from "./PixelAvatar";

export interface MeetingGridProps {
  participants: MeetingParticipant[];
  selfId: string;
  selfChar?: string | undefined;
}

export default function MeetingGrid({ participants, selfId, selfChar }: MeetingGridProps) {
  const room = useSyncExternalStore(
    roomVideo.onRoomChanged,
    () => roomVideo.lkRoom,
    () => null,
  );
  return (
    <div className="meet-grid" data-testid="meeting-grid">
      {room ? (
        <RoomContext.Provider value={room}>
          <ConnectedGrid participants={participants} selfId={selfId} selfChar={selfChar} />
        </RoomContext.Provider>
      ) : (
        <RosterGrid participants={participants} selfId={selfId} selfChar={selfChar} />
      )}
    </div>
  );
}

/** LiveKit-connected path: tracks (camera + screen share) drive the tiles. */
function ConnectedGrid({ participants, selfId, selfChar }: MeetingGridProps) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const names = new Map(participants.map((participant) => [participant.id, participant.name]));
  return (
    <GridLayout tracks={tracks} className="meet-grid-layout">
      <MeetTile names={names} selfId={selfId} selfChar={selfChar} />
    </GridLayout>
  );
}

/** Rendered by GridLayout once per track reference (via TrackRefContext). */
function MeetTile({
  names,
  selfId,
  selfChar,
}: {
  names: Map<string, string>;
  selfId: string;
  selfChar?: string | undefined;
}) {
  const trackRef = useEnsureTrackRef();
  const id = trackRef.participant.identity;
  const self = id === selfId;
  const screenShare = trackRef.source === Track.Source.ScreenShare;
  const hasVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted;
  const name = names.get(id) ?? trackRef.participant.name ?? id;
  return (
    <ParticipantTile trackRef={trackRef} className="meet-tile">
      <TileBody
        playerId={id}
        name={screenShare ? `${name} · screen` : name}
        self={self}
        selfChar={selfChar}
        morph={self && !screenShare}
      >
        {hasVideo ? <VideoTrack trackRef={trackRef} className="meet-tile-video" /> : null}
      </TileBody>
    </ParticipantTile>
  );
}

/** Media-less path: one camera-off tile per roster entry. */
function RosterGrid({ participants, selfId, selfChar }: MeetingGridProps) {
  return (
    <div className="meet-grid-layout meet-grid-roster">
      {participants.map((participant) => (
        <div key={participant.id} className="meet-tile">
          <TileBody
            playerId={participant.id}
            name={participant.name}
            self={participant.id === selfId}
            selfChar={selfChar}
            morph={participant.id === selfId}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Shared tile content: video when provided, otherwise the in-game pixel
 * sprite; always a username nameplate. The local player's tile carries the
 * `meet-tile-self` layoutId so the seat ghost in MeetingOverlay morphs into
 * it on reveal (spatial continuity: that character became this tile).
 */
function TileBody({
  playerId,
  name,
  self,
  selfChar,
  morph,
  children,
}: {
  playerId: string;
  name: string;
  self: boolean;
  selfChar?: string | undefined;
  morph: boolean;
  children?: React.ReactNode;
}) {
  return (
    <motion.div
      className="meet-tile-inner"
      data-testid="meet-tile"
      data-player={playerId}
      {...(morph ? { layoutId: "meet-tile-self" } : {})}
    >
      {children ?? (
        <div className="meet-tile-avatar" data-testid="meet-tile-avatar">
          <PixelAvatar playerId={playerId} char={self ? selfChar : undefined} />
        </div>
      )}
      <span className="meet-nameplate">
        {name}
        {self ? " (you)" : ""}
      </span>
    </motion.div>
  );
}
