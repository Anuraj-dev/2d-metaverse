/**
 * Pure aggregation for the social-arrival read model (PRD 25.26).
 *
 * Plain values in, a `PresenceSnapshot` out — no Redis, Socket.IO, or timers. The
 * socket shell gathers the raw authoritative inputs (Redis presence positions,
 * room channel membership, live meetings, board matches, stage-zone occupancy)
 * and this module decides each student's single activity and the list of active
 * spaces. Keeping the rules here makes the "who is where" decision exhaustively
 * testable without booting a server.
 *
 * Truthfulness rule: every activity reported is derived from server-authoritative
 * state. A student is placed in exactly one activity by precedence
 * (meeting > room > board > stage > world); arcade is never reported because the
 * server cannot observe a client-side cabinet overlay.
 */
import type {
  ActiveSpace,
  ActiveSpaceKind,
  PilotScheduleEntry,
  PresencePerson,
  PresenceSnapshot,
} from "@metaverse/shared";
import { LIMITS } from "@metaverse/shared";

/** Human label for the stage gathering (there is one stage per space). */
export const STAGE_PLACE_LABEL = "Stage";
/** Stable id for the stage as an active space. */
export const STAGE_SPACE_ID = "stage";

export interface PresenceRoomInput {
  id: string;
  label: string;
  /** Player ids currently inside the room channel. */
  occupants: readonly string[];
  /** Whether a live meeting is running in this room right now. */
  meetingActive: boolean;
}

export interface PresenceBoardInput {
  id: string;
  label: string;
  /** Player ids seated at the table (0–2). */
  seated: readonly string[];
}

export interface PresenceReadModelInput {
  spaceId: string;
  /** Online students with their last authoritative position. */
  online: readonly { id: string; name: string; x: number; y: number }[];
  rooms: readonly PresenceRoomInput[];
  boards: readonly PresenceBoardInput[];
  /** Player ids whose server position is inside the stage gathering zone. */
  stageOccupantIds: readonly string[];
  nextScheduled: PilotScheduleEntry | null;
}

/** Deterministic ordering so equal snapshots serialize identically. */
const SPACE_KIND_ORDER: Record<ActiveSpaceKind, number> = { meeting: 0, room: 1, board: 2, stage: 3 };

export function buildPresenceSnapshot(input: PresenceReadModelInput): PresenceSnapshot {
  const roomByPlayer = new Map<string, { label: string; meetingActive: boolean }>();
  for (const room of input.rooms) {
    for (const playerId of room.occupants) {
      // First room wins (a player is only ever in one room channel).
      if (!roomByPlayer.has(playerId)) {
        roomByPlayer.set(playerId, { label: room.label, meetingActive: room.meetingActive });
      }
    }
  }

  const boardByPlayer = new Map<string, string>();
  for (const board of input.boards) {
    for (const playerId of board.seated) {
      if (!boardByPlayer.has(playerId)) boardByPlayer.set(playerId, board.label);
    }
  }

  const stageSet = new Set(input.stageOccupantIds);

  const people: PresencePerson[] = input.online
    .map((student): PresencePerson => {
      const room = roomByPlayer.get(student.id);
      if (room) {
        return {
          id: student.id,
          name: student.name,
          activity: room.meetingActive ? "meeting" : "room",
          place: room.label,
        };
      }
      const boardLabel = boardByPlayer.get(student.id);
      if (boardLabel !== undefined) {
        return { id: student.id, name: student.name, activity: "board", place: boardLabel };
      }
      if (stageSet.has(student.id)) {
        return { id: student.id, name: student.name, activity: "stage", place: STAGE_PLACE_LABEL };
      }
      return { id: student.id, name: student.name, activity: "world", place: null };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, LIMITS.presenceMaxPeople);

  const activeSpaces: ActiveSpace[] = [];
  for (const room of input.rooms) {
    if (room.occupants.length === 0) continue;
    activeSpaces.push({
      kind: room.meetingActive ? "meeting" : "room",
      id: room.id,
      label: room.label,
      count: room.occupants.length,
    });
  }
  for (const board of input.boards) {
    if (board.seated.length === 0) continue;
    activeSpaces.push({ kind: "board", id: board.id, label: board.label, count: board.seated.length });
  }
  if (stageSet.size > 0) {
    activeSpaces.push({ kind: "stage", id: STAGE_SPACE_ID, label: STAGE_PLACE_LABEL, count: stageSet.size });
  }

  activeSpaces.sort(
    (a, b) => SPACE_KIND_ORDER[a.kind] - SPACE_KIND_ORDER[b.kind] || a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
  );

  return {
    spaceId: input.spaceId,
    people,
    activeSpaces: activeSpaces.slice(0, LIMITS.presenceMaxSpaces),
    nextScheduled: input.nextScheduled,
  };
}
