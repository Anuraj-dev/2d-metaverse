/**
 * Pure view-model for the social-arrival HUD (PRD 25.26).
 *
 * Maps a connection status + the latest server presence snapshot onto the four
 * visually/semantically distinct arrival states the spec requires (loading,
 * empty, offline, failed) plus the populated "active" view. Plain values in, a
 * view descriptor out — no React, DOM, Phaser, or net imports — so the "what do
 * we show on arrival?" decision is table-testable. The panel is a thin renderer.
 *
 * This model is read-only: it powers truthful locate/view actions, never a join.
 */
import type { ActiveSpace, PilotScheduleEntry, PresencePerson, PresenceSnapshot } from "@metaverse/shared";

/** Connection status the panel feeds in, independent of the snapshot contents. */
export type ArrivalStatus = "loading" | "ready" | "offline" | "failed";

export interface SocialArrivalInput {
  status: ArrivalStatus;
  /** Latest snapshot, or null before the first one arrives. */
  snapshot: PresenceSnapshot | null;
  /** The viewing student's own id, so they are excluded from "others online". */
  selfId: string;
}

export type SocialArrivalView =
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "failed" }
  | { kind: "empty" }
  | {
      kind: "active";
      /** Online students other than the viewer, server-sorted by name. */
      others: readonly PresencePerson[];
      /** Active rooms/meetings/board tables/stage, non-empty. */
      spaces: readonly ActiveSpace[];
      /** The next scheduled community activity, if any. */
      nextScheduled: PilotScheduleEntry | null;
      /** Total students online, including the viewer. */
      onlineCount: number;
    };

export function socialArrivalView(input: SocialArrivalInput): SocialArrivalView {
  if (input.status === "offline") return { kind: "offline" };
  if (input.status === "failed") return { kind: "failed" };
  if (input.status === "loading" || input.snapshot === null) return { kind: "loading" };

  const { people, activeSpaces, nextScheduled } = input.snapshot;
  const others = people.filter((person) => person.id !== input.selfId);

  if (others.length === 0 && activeSpaces.length === 0 && nextScheduled === null) {
    return { kind: "empty" };
  }
  return {
    kind: "active",
    others,
    spaces: activeSpaces,
    nextScheduled,
    onlineCount: people.length,
  };
}
