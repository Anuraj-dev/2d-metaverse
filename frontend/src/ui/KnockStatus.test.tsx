import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { bus } from "../game/eventBus";

/**
 * The knocking-requester card (PRD 14) names the room being knocked on (PRD 22):
 * the scene emits `knocking`{roomId,name} with the AREA_NAMES display name, and
 * the card surfaces it so the knocker knows exactly which door they're at.
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
    cancelKnock: vi.fn(),
  };
});
vi.mock("../net/shared", () => ({ sharedNet: () => net }));

import KnockStatus from "./KnockStatus";

describe("KnockStatus", () => {
  afterEach(cleanup);

  it("names the room being knocked on", () => {
    render(<KnockStatus />);
    act(() =>
      bus.emit("knocking", { roomId: "4", name: "Cauvery Hostel · Room 4" }),
    );
    expect(screen.getByText(/Cauvery Hostel · Room 4/)).toBeTruthy();
  });
});
