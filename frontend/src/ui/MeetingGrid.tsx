/**
 * The Discord/Meet-style meeting grid (PRD 23). Tiles derive from BOTH sources:
 *  - the server-sent meeting roster (participants + names) — always present, so
 *    the grid renders even when media is unavailable (roster fallback);
 *  - the meeting room's LiveKit connection (media/livekit.ts roomVideo) — its
 *    camera + screen-share tracks, read straight off the Room via `useTracks`.
 *
 * All layout/focus arithmetic lives in the pure, tested `game/meetingLayout`
 * view-model (scene-as-glue + pure modules): this component only maps LiveKit
 * track refs → plain tiles, feeds them to `arrangeMeeting`, and renders the
 * result. An active screen share (or a manually clicked tile) becomes the large
 * focus tile with everyone else in a filmstrip; otherwise an aspect-stable
 * symmetric grid. Enter/exit + focus changes animate (~200ms); a camera on/off
 * swaps in place within the same keyed tile, so neighbours never reflow.
 */
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  RoomContext,
  VideoTrack,
  isTrackReference,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { AnimatePresence, motion } from "motion/react";
import type { MeetingParticipant } from "@metaverse/shared";
import { roomVideo } from "../media/livekit";
import { speakingState } from "../media/speakingState";
import {
  TILE_ASPECT,
  arrangeMeeting,
  fitCells,
  type MeetingTile,
  type Size,
} from "../game/meetingLayout";
import PixelAvatar from "./PixelAvatar";

/** A tile ready to render — plain data (connected path) or roster placeholder. */
interface RenderTile {
  key: string;
  participantId: string;
  name: string;
  self: boolean;
  source: "camera" | "screen";
  hasVideo: boolean;
  trackRef?: TrackReferenceOrPlaceholder;
}

/** Whether a participant is an active speaker, off the shared media seam (PRD 20). */
function useSpeaking(playerId: string): boolean {
  return useSyncExternalStore(
    (cb) => speakingState.subscribe(() => cb()),
    () => speakingState.speaking.has(playerId),
    () => false,
  );
}

/** Track the pixel size of an element (for aspect-preserving cell math). */
function useElementSize(): [React.RefObject<HTMLDivElement | null>, Size] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    // jsdom (unit tests) has no ResizeObserver — the grid then falls back to
    // CSS sizing (fitCells returns 0, no inline size). Real browsers observe.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

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

/** LiveKit-connected path: camera + screen-share tracks drive the tiles. */
function ConnectedGrid({ participants, selfId, selfChar }: MeetingGridProps) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const names = useMemo(
    () => new Map(participants.map((p) => [p.id, p.name])),
    [participants],
  );
  const tiles: RenderTile[] = tracks.map((trackRef) => {
    const id = trackRef.participant.identity;
    const isScreen = trackRef.source === Track.Source.ScreenShare;
    const name = names.get(id) ?? trackRef.participant.name ?? id;
    return {
      key: `${id}:${isScreen ? "screen" : "camera"}`,
      participantId: id,
      name: isScreen ? `${name} · screen` : name,
      self: id === selfId,
      source: isScreen ? "screen" : "camera",
      hasVideo: isTrackReference(trackRef) && !trackRef.publication.isMuted,
      trackRef,
    };
  });
  return <MeetingStage tiles={tiles} selfChar={selfChar} />;
}

/** Media-less path: one camera-off tile per roster entry. */
function RosterGrid({ participants, selfId, selfChar }: MeetingGridProps) {
  const tiles: RenderTile[] = participants.map((p) => ({
    key: `${p.id}:camera`,
    participantId: p.id,
    name: p.name,
    self: p.id === selfId,
    source: "camera",
    hasVideo: false,
  }));
  return <MeetingStage tiles={tiles} selfChar={selfChar} />;
}

/**
 * Shared stage: assigns each tile a stable arrival order, resolves the
 * arrangement via the pure view-model, and renders focus/filmstrip or grid.
 */
function MeetingStage({ tiles, selfChar }: { tiles: RenderTile[]; selfChar?: string | undefined }) {
  const [manualFocusKey, setManualFocusKey] = useState<string | null>(null);
  const byKey = new Map(tiles.map((t) => [t.key, t]));

  // Arrival order = position in the LiveKit track array (new tracks — incl. a
  // fresh screen share — are appended), so "most recent share wins focus" needs
  // no mutable counter. A stale manual focus key is simply ignored by the pure
  // view-model (resolveFocusKey guards presence), so no cleanup effect is needed.
  const layoutTiles: MeetingTile[] = tiles.map((t, index) => ({
    key: t.key,
    participantId: t.participantId,
    source: t.source,
    self: t.self,
    hasVideo: t.hasVideo,
    order: index,
  }));

  const arrangement = arrangeMeeting({ tiles: layoutTiles, manualFocusKey });

  const toggleFocus = (key: string) => setManualFocusKey((prev) => (prev === key ? null : key));

  const [gridRef, gridSize] = useElementSize();
  const cell = fitCells(gridSize, arrangement.dims, TILE_ASPECT, 12);
  const cellSize = cell.width > 0 ? { width: cell.width, height: cell.height } : null;

  const renderTile = (key: string, variant: "focus" | "filmstrip" | "grid") => {
    const t = byKey.get(key);
    if (!t) return null;
    const sizeProps = variant === "grid" && cellSize ? { style: cellSize } : {};
    return (
      <motion.div
        key={key}
        layout
        {...(t.self && t.source === "camera" ? { layoutId: "meet-tile-self" } : {})}
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.85 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className={`meet-tile meet-tile-${variant}`}
        {...sizeProps}
        onClick={() => toggleFocus(key)}
        data-testid="meet-tile"
        data-player={t.participantId}
        data-source={t.source}
        data-focused={variant === "focus"}
      >
        <TileBody tile={t} selfChar={selfChar} screen={t.source === "screen"} />
      </motion.div>
    );
  };

  if (arrangement.mode === "focus" && arrangement.focusKey) {
    return (
      <div className="meet-stage meet-stage-focus" data-testid="meeting-stage" data-mode="focus">
        <div className="meet-focus">
          <AnimatePresence>{renderTile(arrangement.focusKey, "focus")}</AnimatePresence>
        </div>
        {arrangement.filmstrip.length > 0 && (
          <div className="meet-filmstrip" data-testid="meeting-filmstrip">
            <AnimatePresence>
              {arrangement.filmstrip.map((key) => renderTile(key, "filmstrip"))}
            </AnimatePresence>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="meet-stage meet-stage-grid"
      data-testid="meeting-stage"
      data-mode="grid"
      ref={gridRef}
    >
      <AnimatePresence>{arrangement.grid.map((key) => renderTile(key, "grid"))}</AnimatePresence>
    </div>
  );
}

/**
 * Tile content: the video track when present (screen shares are letterboxed so
 * content stays readable; cameras fill), otherwise the participant's in-game
 * pixel sprite; always a username nameplate + speaking ring.
 */
function TileBody({
  tile,
  selfChar,
  screen,
}: {
  tile: RenderTile;
  selfChar?: string | undefined;
  screen: boolean;
}) {
  const speaking = useSpeaking(tile.participantId);
  const videoRef =
    tile.hasVideo && tile.trackRef && isTrackReference(tile.trackRef) ? tile.trackRef : null;
  return (
    <div className={`meet-tile-inner ${speaking ? "speaking" : ""}`} data-speaking={speaking}>
      {videoRef ? (
        <VideoTrack
          trackRef={videoRef}
          className={`meet-tile-video ${screen ? "screen" : ""}`}
        />
      ) : (
        <div className="meet-tile-avatar" data-testid="meet-tile-avatar">
          <PixelAvatar playerId={tile.participantId} char={tile.self ? selfChar : undefined} />
        </div>
      )}
      <span className="meet-nameplate">
        {tile.name}
        {tile.self && !screen ? " (you)" : ""}
      </span>
    </div>
  );
}
