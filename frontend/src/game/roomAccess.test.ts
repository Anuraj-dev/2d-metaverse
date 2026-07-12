import { describe, expect, it } from "vitest";
import {
  CAPACITY_MESSAGE,
  adminPanelView,
  doorPassable,
  isRoomOpen,
  knockResultMessage,
  shouldAnnounceKnock,
  type RoomOpenState,
} from "./roomAccess";

const open = (allowAll: boolean, atCapacity: boolean): RoomOpenState => ({ allowAll, atCapacity });

describe("isRoomOpen / doorPassable / shouldAnnounceKnock", () => {
  it("is open only when allow-all is on and under capacity", () => {
    expect(isRoomOpen(undefined)).toBe(false);
    expect(isRoomOpen(open(false, false))).toBe(false);
    expect(isRoomOpen(open(true, false))).toBe(true);
    expect(isRoomOpen(open(true, true))).toBe(false); // full → door reappears
  });

  it("lets an admitted client through regardless of open state", () => {
    expect(doorPassable(true, undefined)).toBe(true);
    expect(doorPassable(true, open(true, true))).toBe(true);
  });

  it("lets anyone through an open door without prior admission", () => {
    expect(doorPassable(false, open(true, false))).toBe(true);
    expect(doorPassable(false, open(false, false))).toBe(false);
    expect(doorPassable(false, open(true, true))).toBe(false);
  });

  it("announces a knock only when the door is closed", () => {
    expect(shouldAnnounceKnock(undefined)).toBe(true);
    expect(shouldAnnounceKnock(open(false, false))).toBe(true);
    expect(shouldAnnounceKnock(open(true, false))).toBe(false); // open → silent walk-in
    expect(shouldAnnounceKnock(open(true, true))).toBe(true);
  });
});

describe("adminPanelView", () => {
  const requests = [{ id: "b", name: "Bo" }, { id: "c", name: "Cy" }];

  it("shows the admin their controls and the pending queue", () => {
    const view = adminPanelView({
      selfId: "a",
      admin: { id: "a", name: "Al" },
      open: open(false, false),
      pending: requests,
    });
    expect(view).toEqual({
      isAdmin: true,
      badge: "You're the room admin",
      showToggle: true,
      allowAll: false,
      atCapacity: false,
      requests,
    });
  });

  it("shows a non-admin only who the admin is, and no queue", () => {
    const view = adminPanelView({
      selfId: "z",
      admin: { id: "a", name: "Al" },
      open: open(true, false),
      pending: requests,
    });
    expect(view.isAdmin).toBe(false);
    expect(view.badge).toBe("Admin: Al");
    expect(view.showToggle).toBe(false);
    expect(view.allowAll).toBe(true);
    expect(view.requests).toEqual([]);
  });

  it("shows nothing when there is no admin yet", () => {
    const view = adminPanelView({ selfId: "a", admin: null, open: undefined, pending: [] });
    expect(view.badge).toBeNull();
    expect(view.isAdmin).toBe(false);
    expect(view.showToggle).toBe(false);
  });

  it("reflects capacity so the door affordance can update", () => {
    const view = adminPanelView({
      selfId: "a",
      admin: { id: "a", name: "Al" },
      open: open(true, true),
      pending: [],
    });
    expect(view.allowAll).toBe(true);
    expect(view.atCapacity).toBe(true);
  });
});

describe("requester feedback copy", () => {
  it("distinguishes an explicit denial from a timeout", () => {
    expect(knockResultMessage("denied")).toMatch(/declined/i);
    expect(knockResultMessage("timeout")).toMatch(/no answer/i);
  });
  it("tells a too-far knocker to step up to the door", () => {
    expect(knockResultMessage("too-far")).toMatch(/door/i);
  });
  it("has a capacity message", () => {
    expect(CAPACITY_MESSAGE).toMatch(/capacity/i);
  });
});
