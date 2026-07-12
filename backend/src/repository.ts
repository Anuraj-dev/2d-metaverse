import { pool } from "./db.js";

export interface RoomRecord {
  id: string;
  spaceId: string;
  capacity: number;
}

export async function spaceExists(spaceId: string): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM spaces WHERE id = $1", [spaceId]);
  return result.rowCount === 1;
}

export async function getSpace(spaceId: string) {
  const [spaceResult, roomsResult] = await Promise.all([
    pool.query<{ map_json_url: string }>("SELECT map_json_url FROM spaces WHERE id = $1", [spaceId]),
    pool.query<{
      room_id: string;
      room_name: string;
      door_zone: { x: number; y: number; width: number; height: number };
      seat_id: number | null;
      x: number | null;
      y: number | null;
      facing: "down" | "left" | "right" | "up" | null;
    }>(
      `SELECT r.id AS room_id, r.name AS room_name, r.door_zone,
              s.id AS seat_id, s.x, s.y, s.facing
       FROM rooms r
       LEFT JOIN seats s ON s.room_id = r.id
       WHERE r.space_id = $1
       ORDER BY r.id, s.id`,
      [spaceId]
    )
  ]);

  const space = spaceResult.rows[0];
  if (!space) return null;

  const rooms = new Map<string, {
    id: string;
    name: string;
    doorZone: { x: number; y: number; width: number; height: number };
    seats: { id: number; x: number; y: number; facing: "down" | "left" | "right" | "up" }[];
  }>();
  for (const row of roomsResult.rows) {
    let room = rooms.get(row.room_id);
    if (!room) {
      room = { id: row.room_id, name: row.room_name, doorZone: row.door_zone, seats: [] };
      rooms.set(row.room_id, room);
    }
    if (row.seat_id !== null && row.x !== null && row.y !== null && row.facing !== null) {
      room.seats.push({ id: row.seat_id, x: row.x, y: row.y, facing: row.facing });
    }
  }
  return { mapJsonUrl: space.map_json_url, rooms: [...rooms.values()] };
}

export async function getRoom(roomId: string): Promise<RoomRecord | null> {
  const result = await pool.query<{
    id: string;
    space_id: string;
    capacity: number;
  }>("SELECT id, space_id, capacity FROM rooms WHERE id = $1", [roomId]);
  const row = result.rows[0];
  return row ? { id: row.id, spaceId: row.space_id, capacity: row.capacity } : null;
}

export async function seatExists(roomId: string, seatId: number): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM seats WHERE room_id = $1 AND id = $2", [roomId, seatId]);
  return result.rowCount === 1;
}

export async function getSeatIds(roomId: string): Promise<number[]> {
  const result = await pool.query<{ id: number }>("SELECT id FROM seats WHERE room_id = $1 ORDER BY id", [roomId]);
  return result.rows.map((row) => row.id);
}

/**
 * Record a score for a user on a game, keeping only their best (a lower score
 * is ignored). Returns the user's best after the write. Client-reported scores
 * are trusted at this level — see README's arcade high-scores caveat.
 */
export async function submitArcadeScore(
  userId: string,
  game: string,
  score: number
): Promise<number> {
  const result = await pool.query<{ score: number }>(
    `INSERT INTO arcade_scores (user_id, game, score, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, game) DO UPDATE
       SET score = GREATEST(arcade_scores.score, EXCLUDED.score),
           updated_at = now()
     RETURNING score`,
    [userId, game, score]
  );
  return result.rows[0]?.score ?? score;
}

/** The top-N best scores for a game, joined to usernames, highest first. */
export async function getArcadeLeaderboard(
  game: string,
  limit: number
): Promise<{ username: string; score: number }[]> {
  const result = await pool.query<{ username: string; score: number }>(
    `SELECT u.username, a.score
     FROM arcade_scores a
     JOIN users u ON u.id = a.user_id
     WHERE a.game = $1
     ORDER BY a.score DESC, a.updated_at ASC
     LIMIT $2`,
    [game, limit]
  );
  return result.rows.map((row) => ({ username: row.username, score: row.score }));
}

/** A single user's best on a game, or null if they have never scored. */
export async function getArcadeBest(
  userId: string,
  game: string
): Promise<number | null> {
  const result = await pool.query<{ score: number }>(
    "SELECT score FROM arcade_scores WHERE user_id = $1 AND game = $2",
    [userId, game]
  );
  return result.rows[0]?.score ?? null;
}

/** Fields persisted for one moderation record (PRD 25.12). */
export interface ReportInput {
  reporterId: string;
  targetId: string;
  messageId: string;
  messageText: string;
  scope: string;
  category: string;
  note?: string | undefined;
}

/**
 * Persist a chat report, deduping on (reporter, message). Returns `"created"`
 * when a fresh record was written, or `"duplicate"` when this reporter had
 * already flagged the same message (idempotent — no second row).
 */
export async function insertReport(input: ReportInput): Promise<"created" | "duplicate"> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO reports (reporter_id, target_id, message_id, message_text, scope, category, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (reporter_id, message_id) DO NOTHING
     RETURNING id`,
    [input.reporterId, input.targetId, input.messageId, input.messageText, input.scope, input.category, input.note ?? null]
  );
  return (result.rowCount ?? 0) > 0 ? "created" : "duplicate";
}

/* ------------------------------ blocks (PRD 25.13) ------------------------- */

/**
 * Persist a directed block, deduping on (blocker, blocked). Returns `"blocked"`
 * when a fresh row was written, or `"already-blocked"` when it existed (idempotent).
 */
export async function insertBlock(blockerId: string, blockedId: string): Promise<"blocked" | "already-blocked"> {
  const result = await pool.query<{ blocker_id: string }>(
    `INSERT INTO blocks (blocker_id, blocked_id)
     VALUES ($1, $2)
     ON CONFLICT (blocker_id, blocked_id) DO NOTHING
     RETURNING blocker_id`,
    [blockerId, blockedId]
  );
  return (result.rowCount ?? 0) > 0 ? "blocked" : "already-blocked";
}

/**
 * Remove a directed block. Returns `"unblocked"` when a row was deleted, or
 * `"not-blocked"` when there was nothing to remove (idempotent).
 */
export async function removeBlock(blockerId: string, blockedId: string): Promise<"unblocked" | "not-blocked"> {
  const result = await pool.query(
    "DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2",
    [blockerId, blockedId]
  );
  return (result.rowCount ?? 0) > 0 ? "unblocked" : "not-blocked";
}

/** The ids a user has blocked (outgoing edges). */
export async function listBlockedIds(blockerId: string): Promise<string[]> {
  const result = await pool.query<{ blocked_id: string }>(
    "SELECT blocked_id FROM blocks WHERE blocker_id = $1",
    [blockerId]
  );
  return result.rows.map((row) => row.blocked_id);
}

/** The ids that have blocked a user (incoming edges). */
export async function listBlockerIds(blockedId: string): Promise<string[]> {
  const result = await pool.query<{ blocker_id: string }>(
    "SELECT blocker_id FROM blocks WHERE blocked_id = $1",
    [blockedId]
  );
  return result.rows.map((row) => row.blocker_id);
}

/* --------------------------- moderation (PRD 25.14) ------------------------ */

/** Does a user exist? Used before recording an action against a target id. */
export async function userExists(userId: string): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM users WHERE id = $1", [userId]);
  return (result.rowCount ?? 0) > 0;
}

/** One report row as surfaced to a moderator (snapshot the report already holds). */
export interface ReportRow {
  id: string;
  reporterId: string;
  targetId: string;
  messageId: string;
  messageText: string;
  scope: string;
  category: string;
  note: string | null;
  status: string;
  createdAt: string;
}

/** The open review queue, newest first, capped. */
export async function listOpenReports(limit: number): Promise<ReportRow[]> {
  const result = await pool.query<{
    id: string;
    reporter_id: string;
    target_id: string;
    message_id: string;
    message_text: string;
    scope: string;
    category: string;
    note: string | null;
    status: string;
    created_at: Date;
  }>(
    `SELECT id, reporter_id, target_id, message_id, message_text, scope, category, note, status, created_at
     FROM reports WHERE status = 'open' ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows.map((row) => ({
    id: row.id,
    reporterId: row.reporter_id,
    targetId: row.target_id,
    messageId: row.message_id,
    messageText: row.message_text,
    scope: row.scope,
    category: row.category,
    note: row.note,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  }));
}

/**
 * Transition a report's review status. Returns the report's target id when a row
 * was updated (so the caller can audit-log it), or null when no such report
 * existed. `moderatorId` records who reviewed it.
 */
export async function setReportStatus(
  reportId: string,
  status: "dismissed" | "actioned",
  moderatorId: string
): Promise<{ targetId: string } | null> {
  const result = await pool.query<{ target_id: string }>(
    `UPDATE reports SET status = $2, reviewed_by = $3, reviewed_at = now()
     WHERE id = $1 RETURNING target_id`,
    [reportId, status, moderatorId]
  );
  const row = result.rows[0];
  return row ? { targetId: row.target_id } : null;
}

/** The current suspension expiry (epoch ms) for a user, or null if none on record. */
export async function getSuspension(userId: string): Promise<{ suspendedUntil: number } | null> {
  const result = await pool.query<{ suspended_until: Date }>(
    "SELECT suspended_until FROM suspensions WHERE user_id = $1",
    [userId]
  );
  const row = result.rows[0];
  return row ? { suspendedUntil: row.suspended_until.getTime() } : null;
}

/** Set (or replace) a user's suspension. `until` is epoch ms. */
export async function upsertSuspension(
  userId: string,
  until: number,
  actorId: string,
  reason?: string
): Promise<void> {
  await pool.query(
    `INSERT INTO suspensions (user_id, suspended_until, reason, actor_id)
     VALUES ($1, to_timestamp($2 / 1000.0), $3, $4)
     ON CONFLICT (user_id) DO UPDATE
       SET suspended_until = EXCLUDED.suspended_until,
           reason = EXCLUDED.reason,
           actor_id = EXCLUDED.actor_id,
           created_at = now()`,
    [userId, until, reason ?? null, actorId]
  );
}

/** Remove a user's suspension (reversal). Returns true when a row was deleted. */
export async function deleteSuspension(userId: string): Promise<boolean> {
  const result = await pool.query("DELETE FROM suspensions WHERE user_id = $1", [userId]);
  return (result.rowCount ?? 0) > 0;
}

/** Fields of one durable moderation audit row. */
export interface ModerationActionInput {
  actorId: string;
  targetId: string | null;
  action: "dismiss" | "warn" | "suspend" | "unsuspend";
  reportId?: string | null;
  suspendUntil?: number | null;
  reason?: string | null;
}

/** Append one row to the moderation audit trail. */
export async function recordModerationAction(input: ModerationActionInput): Promise<void> {
  await pool.query(
    `INSERT INTO moderation_actions (actor_id, target_id, action, report_id, suspend_until, reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.actorId,
      input.targetId,
      input.action,
      input.reportId ?? null,
      input.suspendUntil != null ? new Date(input.suspendUntil) : null,
      input.reason ?? null,
    ]
  );
}
