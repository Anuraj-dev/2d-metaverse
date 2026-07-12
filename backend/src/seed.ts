import path from "node:path";
import { fileURLToPath } from "node:url";
import { roomDisplayName } from "@metaverse/shared";
import { config } from "./config.js";
import { pool } from "./db.js";
import { childLogger } from "./logger.js";
// Rooms are no longer password-gated (PRD 14): the first player to enter becomes
// the admin and later arrivals knock. Only geometry (door zone) + seats are
// seeded, from the pure `seed-geometry` table cross-checked against the
// generated geometry manifest.
import { rooms } from "./seed-geometry.js";

const log = childLogger({ module: "seed" });

export async function seed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO spaces (id, name, map_json_url) VALUES ('1', 'Main Space', $1)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, map_json_url = EXCLUDED.map_json_url`,
      [config.MAP_JSON_URL]
    );
    for (const room of rooms) {
      await client.query(
        `INSERT INTO rooms (id, space_id, name, door_zone, capacity)
         VALUES ($1, '1', $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name,
           door_zone = EXCLUDED.door_zone, capacity = EXCLUDED.capacity`,
        [room.id, roomDisplayName(room.id), room.doorZone, room.seats.length]
      );
      for (const seat of room.seats) {
        await client.query(
          `INSERT INTO seats (id, room_id, x, y, facing) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (room_id, id) DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y, facing = EXCLUDED.facing`,
          [seat.id, room.id, seat.x, seat.y, seat.facing]
        );
      }
    }
    await client.query("COMMIT");
    log.info({ spaceId: "1", roomCount: rooms.length }, "seeded space");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seed().then(() => pool.end()).catch((error) => { log.fatal({ err: error }, "seed failed"); process.exit(1); });
}
