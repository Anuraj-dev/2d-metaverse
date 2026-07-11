import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { bus } from "../game/eventBus";
import type { PresenceSnapshot } from "@metaverse/shared";

/**
 * Social-arrival HUD test (PRD 25.26). The net layer is a driveable emitter; we
 * assert the distinct arrival states, that locate/view actions fire the reused
 * `locate`/`map-open` bus events (never a join), and that bounded, identity-free
 * analytics are emitted.
 */
const netMock = vi.hoisted(() => {
  const handlers: Record<string, Set<(p: unknown) => void>> = {};
  const net = {
    selfId: "me",
    on: (ev: string, cb: (p: unknown) => void) => {
      const set = (handlers[ev] ??= new Set());
      set.add(cb);
      return () => set.delete(cb);
    },
    emit: (ev: string, p?: unknown) => handlers[ev]?.forEach((cb) => cb(p)),
  };
  return { handlers, net };
});
vi.mock("../net/shared", () => ({ sharedNet: () => netMock.net }));

const analyticsMock = vi.hoisted(() => ({ emitAnalytics: vi.fn() }));
vi.mock("../analytics", () => analyticsMock);

import ArrivalPanel from "./ArrivalPanel";

beforeEach(() => {
  analyticsMock.emitAnalytics.mockClear();
  for (const k of Object.keys(netMock.handlers)) delete netMock.handlers[k];
});
afterEach(cleanup);

const snapshot = (over: Partial<PresenceSnapshot> = {}): PresenceSnapshot => ({
  spaceId: "1",
  people: [{ id: "me", name: "me", activity: "world", place: null }],
  activeSpaces: [],
  nextScheduled: null,
  ...over,
});

const receive = (snap: PresenceSnapshot) => act(() => netMock.net.emit("presence-snapshot", snap));

describe("ArrivalPanel arrival states", () => {
  it("shows loading before any snapshot arrives", () => {
    render(<ArrivalPanel />);
    expect(screen.getByRole("status").textContent).toMatch(/finding who's around/i);
  });

  it("shows a distinct empty state when only the viewer is online", () => {
    render(<ArrivalPanel />);
    receive(snapshot());
    expect(screen.getByRole("status").textContent).toMatch(/nobody else is around/i);
  });

  it("shows a distinct failed state on a connection error", () => {
    render(<ArrivalPanel />);
    act(() => netMock.net.emit("connect_error", { message: "down" }));
    expect(screen.getByRole("status").textContent).toMatch(/couldn't load/i);
  });

  it("lists other students and active spaces when populated", () => {
    render(<ArrivalPanel />);
    receive(
      snapshot({
        people: [
          { id: "me", name: "me", activity: "world", place: null },
          { id: "b", name: "bob", activity: "meeting", place: "Commons" },
        ],
        activeSpaces: [{ kind: "meeting", id: "r1", label: "Commons", count: 1 }],
      }),
    );
    expect(screen.getByText("bob")).toBeTruthy();
    // "Commons" appears as the active-space label (and as bob's place meta).
    expect(screen.getAllByText("Commons").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("heading", { name: "Active spaces" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Students online" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/2 online/i);
  });
});

describe("ArrivalPanel truthful actions + analytics", () => {
  it("locates a student via the reused locate bus event (no join)", () => {
    const located: unknown[] = [];
    const off = bus.on<{ id: string }>("locate", (p) => located.push(p));
    render(<ArrivalPanel />);
    receive(
      snapshot({
        people: [
          { id: "me", name: "me", activity: "world", place: null },
          { id: "b", name: "bob", activity: "world", place: null },
        ],
      }),
    );
    fireEvent.click(screen.getByText("bob"));
    off();
    expect(located).toEqual([{ id: "b" }]);
    expect(analyticsMock.emitAnalytics).toHaveBeenCalledWith({
      name: "presence-locate",
      properties: { targetKind: "world" },
    });
  });

  it("views a space by opening the map (no join)", () => {
    const opened: string[] = [];
    const off = bus.on("map-open", () => opened.push("map-open"));
    render(<ArrivalPanel />);
    receive(snapshot({ activeSpaces: [{ kind: "board", id: "ttt-1", label: "Tic-Tac-Toe", count: 2 }] }));
    fireEvent.click(screen.getByText("Tic-Tac-Toe"));
    off();
    expect(opened).toEqual(["map-open"]);
    expect(analyticsMock.emitAnalytics).toHaveBeenCalledWith({
      name: "presence-locate",
      properties: { targetKind: "board" },
    });
  });

  it("emits a bounded, identity-free arrival-viewed event once", () => {
    render(<ArrivalPanel />);
    receive(snapshot({ activeSpaces: [{ kind: "board", id: "ttt-1", label: "Tic-Tac-Toe", count: 2 }] }));
    receive(snapshot({ activeSpaces: [{ kind: "board", id: "ttt-1", label: "Tic-Tac-Toe", count: 2 }] }));
    const viewedCalls = analyticsMock.emitAnalytics.mock.calls.filter(
      ([e]) => (e as { name: string }).name === "social-arrival-viewed",
    );
    expect(viewedCalls).toHaveLength(1);
    expect(viewedCalls[0]?.[0]).toEqual({
      name: "social-arrival-viewed",
      properties: { onlineCount: 1, activeSpaces: 1, hasSchedule: false },
    });
  });
});
