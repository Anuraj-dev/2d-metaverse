import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { bus } from "../game/eventBus";

/**
 * The in-room admin approve/deny prompt (PRD 14) must stay reachable while the
 * fullscreen meeting overlay is open (PRD 23 fix): the panel is a HUD sibling of
 * the overlay with a higher z-index, not a descendant of it. jsdom has no CSS
 * stacking, so this asserts the structural + behavioural contract — the prompt
 * renders (with Approve/Deny) and is NOT nested inside the meeting overlay — and
 * leaves the z-index itself to the CSS.
 */
type Handler = (payload: unknown) => void;
const net = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    selfId: "me",
    on: vi.fn((event: string, cb: Handler) => {
      handlers.set(event, cb);
      return () => handlers.delete(event);
    }),
    toggleAllowAll: vi.fn(),
    approveKnock: vi.fn(),
    denyKnock: vi.fn(),
  };
});
vi.mock("../net/shared", () => ({ sharedNet: () => net }));

import RoomAdminPanel from "./RoomAdminPanel";

function fire(event: string, payload: unknown) {
  act(() => net.handlers.get(event)?.(payload));
}

beforeEach(() => {
  net.handlers.clear();
  net.on.mockClear();
  net.approveKnock.mockClear();
  net.denyKnock.mockClear();
});
afterEach(cleanup);

describe("RoomAdminPanel over the meeting overlay (PRD 23)", () => {
  it("renders the approval prompt as a sibling of the open meeting overlay", () => {
    render(
      <>
        <div className="meeting-overlay" data-testid="meeting-overlay" />
        <RoomAdminPanel />
      </>,
    );

    // Scope the panel to a room, make this client the admin, and deliver a knock.
    act(() => bus.emit("room-entered", { roomId: "1" }));
    fire("admin-changed", { roomId: "1", admin: { id: "me", name: "raja" }, reason: "initial" });
    fire("room-open-state", { roomId: "1", allowAll: false, atCapacity: false });
    fire("knock-pending", { roomId: "1", knocks: [{ id: "k1", name: "Zoe" }] });

    // The approve/deny prompt is present…
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve).toBeTruthy();
    expect(screen.getByText("Zoe")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deny" })).toBeTruthy();

    // …and it is NOT nested inside the meeting overlay (independent HUD layer, so
    // its higher z-index can win — the overlay never traps it).
    const overlay = screen.getByTestId("meeting-overlay");
    expect(overlay.contains(approve)).toBe(false);
  });
});
