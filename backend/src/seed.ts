import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { pool } from "./db.js";
import { childLogger } from "./logger.js";
import { hashSecret } from "./password.js";

const log = childLogger({ module: "seed" });

const rooms = [
  // Hostel wing rooms (map: campus.json south, PRD 13). Capacities 5/8/12 — seat
  // ids/coords mirror the seats objectgroup the generator authors for rooms 1-3.
  {
    id: "1", name: "Hostel Room 1", key: config.ROOM_1_KEY ?? "1234",
    doorZone: { x: 720, y: 1600, width: 32, height: 16 },
    seats: [
      { id: 0, x: 712, y: 1640, facing: "down" }, { id: 1, x: 744, y: 1640, facing: "down" }, { id: 2, x: 776, y: 1640, facing: "down" }, { id: 3, x: 728, y: 1704, facing: "up" }, { id: 4, x: 760, y: 1704, facing: "up" }
    ]
  },
  {
    id: "2", name: "Hostel Room 2", key: config.ROOM_2_KEY ?? "4321",
    doorZone: { x: 512, y: 1600, width: 32, height: 16 },
    seats: [
      { id: 0, x: 488, y: 1640, facing: "down" }, { id: 1, x: 520, y: 1640, facing: "down" }, { id: 2, x: 552, y: 1640, facing: "down" }, { id: 3, x: 584, y: 1640, facing: "down" }, { id: 4, x: 488, y: 1704, facing: "up" }, { id: 5, x: 520, y: 1704, facing: "up" }, { id: 6, x: 552, y: 1704, facing: "up" }, { id: 7, x: 584, y: 1704, facing: "up" }
    ]
  },
  {
    id: "3", name: "Hostel Room 3", key: config.ROOM_3_KEY ?? "3333",
    doorZone: { x: 272, y: 1600, width: 32, height: 16 },
    seats: [
      { id: 0, x: 216, y: 1656, facing: "down" }, { id: 1, x: 248, y: 1656, facing: "down" }, { id: 2, x: 280, y: 1656, facing: "down" }, { id: 3, x: 312, y: 1656, facing: "down" }, { id: 4, x: 344, y: 1656, facing: "down" }, { id: 5, x: 376, y: 1656, facing: "down" }, { id: 6, x: 216, y: 1720, facing: "up" }, { id: 7, x: 248, y: 1720, facing: "up" }, { id: 8, x: 280, y: 1720, facing: "up" }, { id: 9, x: 312, y: 1720, facing: "up" }, { id: 10, x: 344, y: 1720, facing: "up" }, { id: 11, x: 376, y: 1720, facing: "up" }
    ]
  },
  // Campus HQ rooms (map: campus.json, 120×90 tiles, 16px/tile)
  {
    id: "4", name: "Campus Room D", key: config.ROOM_4_KEY ?? "4444",
    doorZone: { x: 576, y: 176, width: 32, height: 16 },
    seats: [
      { id: 0, x: 568, y: 104, facing: "right" }, { id: 1, x: 632, y: 104, facing: "left" },
      { id: 2, x: 600, y:  72, facing: "down"  }, { id: 3, x: 600, y: 136, facing: "up"   }
    ]
  },
  {
    id: "5", name: "Campus Room E", key: config.ROOM_5_KEY ?? "5555",
    doorZone: { x: 784, y: 176, width: 32, height: 16 },
    seats: [
      { id: 0, x: 776, y: 104, facing: "right" }, { id: 1, x: 840, y: 104, facing: "left" },
      { id: 2, x: 808, y:  72, facing: "down"  }, { id: 3, x: 808, y: 136, facing: "up"   }
    ]
  },
  {
    id: "6", name: "Campus Room F", key: config.ROOM_6_KEY ?? "6666",
    doorZone: { x: 1008, y: 176, width: 32, height: 16 },
    seats: [
      { id: 0, x: 1000, y: 104, facing: "right" }, { id: 1, x: 1064, y: 104, facing: "left" },
      { id: 2, x: 1032, y:  72, facing: "down"  }, { id: 3, x: 1032, y: 136, facing: "up"   }
    ]
  }
] as const;

export async function seed(): Promise<void> {
  if (config.NODE_ENV === "production" && (!config.ROOM_1_KEY || !config.ROOM_2_KEY || !config.ROOM_3_KEY || !config.ROOM_4_KEY || !config.ROOM_5_KEY || !config.ROOM_6_KEY)) {
    throw new Error("ROOM_1_KEY through ROOM_6_KEY are required when seeding production");
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
