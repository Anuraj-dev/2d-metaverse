/**
 * Canonical list of selectable avatar keys. Each key corresponds to a
 * 96×128 Pipoya spritesheet at /assets/characters/<key>.png with the
 * standard 3-col × 4-row (32×32) frame layout.
 *
 * Add a new entry here + drop the PNG in public/assets/characters/ to
 * introduce a new avatar — no other code changes needed.
 */
export const CHARS = [
  // Original four (Penzilla-style interior characters)
  "char1",
  "char2",
  "char3",
  "char4",
  // Expanded roster: Pipoya FREE RPG Character Sprites 32x32
  // Female 01, 02, 05, 07
  "char5",
  "char6",
  "char7",
  "char8",
  // Male 01, 02, 06, 08
  "char9",
  "char10",
  "char11",
  "char12",
] as const;

export type CharKey = (typeof CHARS)[number];

export function isCharKey(v: string): v is CharKey {
  return (CHARS as readonly string[]).includes(v);
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Deterministic avatar for a remote player. The single mapping shared by the
 * Phaser scene (world sprites) and the React meeting grid (camera-off tiles),
 * so "that character became this tile" always holds.
 */
export function charForPlayer(playerId: string): CharKey {
  return CHARS[hash(playerId) % CHARS.length] ?? CHARS[0];
}
