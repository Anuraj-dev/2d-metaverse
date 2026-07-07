/**
 * Pure speaking-ring mapping (PRD 20). Plain sets in / out — no LiveKit, Phaser,
 * or DOM. Given the active-speaker id set (the same signal that drives ambient
 * ducking, via `media/speakingState`) and the ids currently present/visible, decide
 * which players get a green ring: exactly the active speakers we can actually see.
 * The scene renders a ring per returned id; meeting tiles reuse the same mapping.
 */
export function speakingRingIds(
  speaking: Iterable<string>,
  present: Iterable<string>,
): Set<string> {
  const presentSet = present instanceof Set ? present : new Set(present);
  const rings = new Set<string>();
  for (const id of speaking) {
    if (presentSet.has(id)) rings.add(id);
  }
  return rings;
}
