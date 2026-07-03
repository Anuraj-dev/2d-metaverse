import { ARCADE_GAMES, type ArcadeGame } from "@metaverse/shared";

export type InteractableType = "portal" | "info" | "whiteboard" | "arcade";

export interface InteractableDef {
  id: string;
  label: string;
  type: InteractableType;
  rect: { x: number; y: number; w: number; h: number };
  payload: Record<string, string | number>;
}

/** Minimal shape of a Tiled map object (subset of Phaser.Types.Tilemaps.TiledObject). */
interface TiledObj {
  name: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  properties?: Array<{ name: string; value: unknown }>;
}

const VALID_TYPES = new Set<string>(["portal", "info", "whiteboard", "arcade"]);

function getProp(
  props: Array<{ name: string; value: unknown }>,
  name: string
): string | undefined {
  const p = props.find((x) => x.name === name);
  return p !== undefined ? String(p.value) : undefined;
}

/** Parse objects from a Tiled 'interactables' layer into typed InteractableDef structs. */
export function parseInteractables(objects: TiledObj[]): InteractableDef[] {
  const result: InteractableDef[] = [];
  for (const o of objects) {
    const props = o.properties ?? [];
    const type = getProp(props, "interactType");
    if (!type || !VALID_TYPES.has(type)) continue;
    const label = getProp(props, "label") ?? o.name;
    const payload: Record<string, string | number> = {};
    for (const p of props) {
      if (p.name === "interactType" || p.name === "label") continue;
      payload[p.name] =
        typeof p.value === "number" ? p.value : String(p.value ?? "");
    }
    result.push({
      id: o.name,
      label,
      type: type as InteractableType,
      rect: { x: o.x ?? 0, y: o.y ?? 0, w: o.width ?? 32, h: o.height ?? 32 },
      payload,
    });
  }
  return result;
}

/**
 * Returns the first interactable whose zone contains (px, py), or null.
 * Uses inclusive bounds — mirrors Phaser.Geom.Rectangle.Contains.
 */
export function findNear(
  list: InteractableDef[],
  px: number,
  py: number
): InteractableDef | null {
  for (const ia of list) {
    if (
      px >= ia.rect.x &&
      px <= ia.rect.x + ia.rect.w &&
      py >= ia.rect.y &&
      py <= ia.rect.y + ia.rect.h
    ) {
      return ia;
    }
  }
  return null;
}

/**
 * Fail-closed gate for opening the arcade overlay from a cabinet interactable.
 *
 * The scene sleeps the world when a cabinet opens, and only the overlay's close
 * wakes it — so the scene must never sleep for a payload the app shell would
 * ignore (an unknown game id would otherwise freeze the world permanently).
 * Returns the validated open payload, or null when the interactable is not an
 * arcade cabinet or its `game` is not a canonical ARCADE_GAMES id.
 */
export function arcadeOpenPayload(
  ia: InteractableDef
): { game: ArcadeGame; label: string } | null {
  if (ia.type !== "arcade") return null;
  const game = String(ia.payload.game ?? "");
  if (!(ARCADE_GAMES as readonly string[]).includes(game)) return null;
  return { game: game as ArcadeGame, label: ia.label };
}
