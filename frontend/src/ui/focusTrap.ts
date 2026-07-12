/**
 * Pure focus-containment maths for the accessible {@link Dialog} primitive.
 *
 * The dialog owns an ordered list of focusable elements (its own panel controls
 * plus any always-live "keep-live" regions it deliberately leaves reachable —
 * see the Dialog docs). On every Tab / Shift+Tab this decides which index in
 * that list should receive focus so the ring stays inside the set and wraps at
 * both ends. Kept DOM-free so it is exhaustively unit-testable; the React glue
 * only queries the elements and calls `.focus()` on the returned index.
 */

/**
 * Index to force-focus for a Tab press, or `null` when there is nothing to
 * focus (empty set). Always contains focus inside the set:
 *  - interior moves advance/retreat by one and wrap past either boundary;
 *  - a `current` of -1 (focus escaped the set entirely) is pulled back to the
 *    first element on Tab or the last on Shift+Tab.
 *
 * @param count  number of focusable elements in the trap set
 * @param current index of the currently-focused element, or -1 if focus is
 *   outside the set
 * @param shift  whether Shift was held (reverse direction)
 */
export function tabTrapTarget(count: number, current: number, shift: boolean): number | null {
  if (count <= 0) return null;
  if (current < 0 || current >= count) return shift ? count - 1 : 0;
  const next = shift ? current - 1 : current + 1;
  return ((next % count) + count) % count;
}
