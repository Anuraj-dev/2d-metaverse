/**
 * Pure presenter-seat rules for the auditorium sit target.
 * WorldScene stays glue: it snaps the sprite and emits bus events.
 */
import type { Dir } from "@metaverse/shared";

const DIRS = new Set<Dir>(["up", "down", "left", "right"]);

export interface PresenterSeatSpec {
  roomId: "stage";
  seatId: 0;
  facing: Dir;
  rect: { x: number; y: number; width: number; height: number; centerX: number; centerY: number };
  cx: number;
  cy: number;
}

/** Validate a Tiled `facing` string; fall back to down when missing/invalid. */
export function parsePresenterFacing(raw: unknown): Dir {
  if (typeof raw === "string" && DIRS.has(raw as Dir)) return raw as Dir;
  return "down";
}

export function buildPresenterSeat(
  rect: { x: number; y: number; width: number; height: number; centerX: number; centerY: number },
  facingRaw: unknown,
): PresenterSeatSpec {
  return {
    roomId: "stage",
    seatId: 0,
    facing: parsePresenterFacing(facingRaw),
    rect,
    cx: rect.centerX,
    cy: rect.centerY,
  };
}

/**
 * Whether the player may sit in the presenter chair right now.
 * Pure eligibility — no Phaser / net.
 */
export function canPresenterSit(state: {
  hasSeat: boolean;
  seated: boolean;
  boardSeated: boolean;
  presenterSeated: boolean;
  nearPresenterSeat: boolean;
}): boolean {
  return (
    state.hasSeat &&
    !state.seated &&
    !state.boardSeated &&
    !state.presenterSeated &&
    state.nearPresenterSeat
  );
}

/** Next flags after a successful presenter sit. */
export function presenterSit(): { presenterSeated: true; nearPresenterSeat: false } {
  return { presenterSeated: true, nearPresenterSeat: false };
}

/** Next flags after standing from the presenter seat. */
export function presenterStandFrom(seated: boolean): { presenterSeated: false } | null {
  if (!seated) return null;
  return { presenterSeated: false };
}
