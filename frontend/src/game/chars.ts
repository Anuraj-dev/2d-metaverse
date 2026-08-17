/**
 * Canonical list of selectable avatar keys. Each key corresponds to a
 * 96×128 Pipoya spritesheet at /assets/characters/<key>.png with the
 * standard 3-col × 4-row (32×32) frame layout.
 *
 * Add a new entry here + drop the PNG in public/assets/characters/ to
 * introduce a new avatar — no other code changes needed.
 *
 * char5/char7/char9 were removed as visual duplicates of char3/char4/char1;
 * PNGs remain on disk so old localStorage values still resolve via aliases.
 */
export const CHARS = [
  "char1",
  "char2",
  "char3",
  "char4",
  "char6",
  "char8",
  "char10",
  "char11",
  "char12",
] as const;

export type CharKey = (typeof CHARS)[number];

/** Legacy picker keys that were visual duplicates of a keeper. */
const CHAR_ALIASES: Readonly<Record<string, CharKey>> = {
  char5: "char3",
  char7: "char4",
  char9: "char1",
};

export function isCharKey(v: string): v is CharKey {
  return (CHARS as readonly string[]).includes(v);
}

/**
 * Map a stored or override avatar key onto a selectable sprite. Returns null
 * for unknown keys so callers can fall back (e.g. charForPlayer).
 */
export function resolveCharKey(v: string): CharKey | null {
  if (isCharKey(v)) return v;
  return CHAR_ALIASES[v] ?? null;
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
