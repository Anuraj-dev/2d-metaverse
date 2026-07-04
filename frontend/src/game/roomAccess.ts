/**
 * Pure view logic for the room admin / knock system (PRD 14). Plain values in,
 * plain values out — no Phaser, net, or DOM. Decides what each client shows:
 * whether a door is passable/hidden, the admin badge + allow-all toggle the
 * admin sees, the approve/deny queue, and the requester's feedback copy.
 *
 * The scene (WorldScene) and the React panels are thin glue over these
 * functions; the server remains authoritative for every actual decision.
 */

export interface RoomOpenState {
  allowAll: boolean;
  atCapacity: boolean;
}

export interface Requester {
  id: string;
  name: string;
}

export interface AdminRef {
  id: string;
  name: string;
}

/** The door is open (walk straight in) iff allow-all is on and there is room. */
export function isRoomOpen(open: RoomOpenState | undefined): boolean {
  return open !== undefined && open.allowAll && !open.atCapacity;
}

/**
 * Whether this client may pass through a room's doorway: either they have been
 * admitted (entered) or the room is currently open to all.
 */
export function doorPassable(entered: boolean, open: RoomOpenState | undefined): boolean {
  return entered || isRoomOpen(open);
}

/** Whether to show the "Knocking…" UI on approach — skipped when the door is open. */
export function shouldAnnounceKnock(open: RoomOpenState | undefined): boolean {
  return !isRoomOpen(open);
}

export interface AdminPanelView {
  isAdmin: boolean;
  /** Badge line, or null when there is no admin yet. */
  badge: string | null;
  /** The allow-all toggle is shown only to the admin. */
  showToggle: boolean;
  allowAll: boolean;
  atCapacity: boolean;
  /** Pending knockers to approve/deny — shown only to the admin. */
  requests: Requester[];
}

/**
 * Derive the in-room admin panel a client should render from the authoritative
 * signals it has received. Non-admins see only the badge; the admin also sees
 * the allow-all toggle and the pending approve/deny queue.
 */
export function adminPanelView(input: {
  selfId: string | null;
  admin: AdminRef | null;
  open: RoomOpenState | undefined;
  pending: Requester[];
}): AdminPanelView {
  const isAdmin = input.admin !== null && input.selfId !== null && input.admin.id === input.selfId;
  const badge = input.admin === null ? null : isAdmin ? "You're the room admin" : `Admin: ${input.admin.name}`;
  return {
    isAdmin,
    badge,
    showToggle: isAdmin,
    allowAll: input.open?.allowAll ?? false,
    atCapacity: input.open?.atCapacity ?? false,
    requests: isAdmin ? input.pending : [],
  };
}

export const CAPACITY_MESSAGE = "This room is at max capacity.";

/** Feedback copy for a knock that did not get in. */
export function knockResultMessage(result: "denied" | "timeout"): string {
  return result === "timeout" ? "No answer — nobody let you in." : "The admin declined your knock.";
}
