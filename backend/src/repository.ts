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
