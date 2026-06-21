import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { pool } from "./db.js";
import { hashSecret } from "./password.js";

const rooms = [
  {
    id: "1", name: "Meeting Room A", key: config.ROOM_1_KEY ?? "1234",
    doorZone: { x: 96, y: 144, width: 32, height: 16 },
    seats: [
      { id: 0, x: 80, y: 80, facing: "right" }, { id: 1, x: 144, y: 80, facing: "left" },
      { id: 2, x: 112, y: 48, facing: "down" }, { id: 3, x: 112, y: 96, facing: "up" }
    ]
  },
  {
    id: "2", name: "Meeting Room B", key: config.ROOM_2_KEY ?? "4321",
    doorZone: { x: 496, y: 144, width: 32, height: 16 },
    seats: [
      { id: 0, x: 480, y: 80, facing: "right" }, { id: 1, x: 544, y: 80, facing: "left" },
      { id: 2, x: 512, y: 48, facing: "down" }, { id: 3, x: 512, y: 96, facing: "up" }
    ]
  }
] as const;

export async function seed(): Promise<void> {
  if (config.NODE_ENV === "production" && (!config.ROOM_1_KEY || !config.ROOM_2_KEY)) {
    throw new Error("ROOM_1_KEY and ROOM_2_KEY are required when seeding production");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO spaces (id, name, map_json_url) VALUES ('1', 'Main Space', $1)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, map_json_url = EXCLUDED.map_json_url`,
      [config.MAP_JSON_URL]
    );
    for (const room of rooms) {
      const keyHash = await hashSecret(room.key);
      await client.query(
        `INSERT INTO rooms (id, space_id, name, key_hash, door_zone, capacity)
         VALUES ($1, '1', $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, key_hash = EXCLUDED.key_hash,
           door_zone = EXCLUDED.door_zone, capacity = EXCLUDED.capacity`,
        [room.id, room.name, keyHash, room.doorZone, room.seats.length]
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
    console.log("Seeded space 1 with rooms 1 and 2");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seed().then(() => pool.end()).catch((error) => { console.error(error); process.exit(1); });
}
