import { redis } from "./redis.js";
import { parseSeatKey, type SeatRef } from "./seat-key.js";

const SIT_SCRIPT = `
local occupant = redis.call('GET', KEYS[1])
if occupant and occupant ~= ARGV[1] then
  return {0, occupant, ''}
end
local old_key = redis.call('GET', KEYS[2])
if old_key and old_key ~= KEYS[1] and redis.call('GET', old_key) == ARGV[1] then
  redis.call('DEL', old_key)
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('SET', KEYS[2], KEYS[1], 'EX', ARGV[2])
return {1, ARGV[1], old_key or ''}
`;

const STAND_SCRIPT = `
local seat_key = redis.call('GET', KEYS[1])
if not seat_key then return '' end
if redis.call('GET', seat_key) == ARGV[1] then redis.call('DEL', seat_key) end
redis.call('DEL', KEYS[1])
return seat_key
`;

export async function sitPlayer(playerId: string, roomId: string, seatId: number) {
  const seatKey = `seat:${roomId}:${seatId}`;
  const result = await redis.eval(SIT_SCRIPT, {
    keys: [seatKey, `player-seat:${playerId}`],
    arguments: [playerId, String(8 * 60 * 60)]
  }) as [number, string, string];
  return { ok: result[0] === 1, occupant: result[1], previous: parseSeatKey(result[2]) };
}

export async function standPlayer(playerId: string): Promise<SeatRef | null> {
  const result = await redis.eval(STAND_SCRIPT, {
    keys: [`player-seat:${playerId}`],
    arguments: [playerId]
  });
  return parseSeatKey(typeof result === "string" ? result : "");
}
