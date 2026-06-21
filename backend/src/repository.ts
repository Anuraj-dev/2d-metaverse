import { pool } from "./db.js";

export interface RoomRecord {
  id: string;
  spaceId: string;
  keyHash: string;
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
    key_hash: string;
    capacity: number;
  }>("SELECT id, space_id, key_hash, capacity FROM rooms WHERE id = $1", [roomId]);
  const row = result.rows[0];
  return row ? { id: row.id, spaceId: row.space_id, keyHash: row.key_hash, capacity: row.capacity } : null;
}

export async function seatExists(roomId: string, seatId: number): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM seats WHERE room_id = $1 AND id = $2", [roomId, seatId]);
  return result.rowCount === 1;
}

export async function getSeatIds(roomId: string): Promise<number[]> {
  const result = await pool.query<{ id: number }>("SELECT id FROM seats WHERE room_id = $1 ORDER BY id", [roomId]);
  return result.rows.map((row) => row.id);
}
