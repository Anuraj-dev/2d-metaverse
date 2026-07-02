/**
 * Interact-key (E / tap) priority: pure state → which action fires.
 *
 * Extracted from WorldScene.handleInteractKey so the precedence rule is pinned by
 * tests: standing up always wins, then a nearby interactable, and sitting is the
 * fallback (a no-op unless a seat is under the player — see seatDoor.ts).
 */
export type InteractAction = "stand" | "interact" | "sit";

export function interactAction(
  seated: boolean,
  hasInteractable: boolean
): InteractAction {
  if (seated) return "stand";
  if (hasInteractable) return "interact";
  return "sit";
}
