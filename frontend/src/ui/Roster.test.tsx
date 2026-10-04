import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { bus } from "../game/eventBus";

type Handler = (payload: unknown) => void;
const net = vi.hoisted(() => ({ handlers: new Map<string, Handler>() }));
vi.mock("../net/shared", () => ({ sharedNet: () => ({
  on: (event: string, handler: Handler) => {
    net.handlers.set(event, handler);
    return () => net.handlers.delete(event);
  },
}) }));
import Roster from "./Roster";

beforeEach(() => net.handlers.clear());
afterEach(cleanup);

function open() {
  render(<><Roster /><button type="button">Outside</button></>);
  act(() => net.handlers.get("init")?.({ selfId: "me", players: [{ id: "me", name: "Ada" }, { id: "other", name: "Zoe" }] }));
  const trigger = screen.getByRole("button", { name: "Roster: 2 online" });
  fireEvent.click(trigger);
  return trigger;
}

describe("Roster interactions", () => {
  it("dismisses with Escape and returns focus to the roster trigger", () => {
    const trigger = open();
    const row = screen.getByRole("button", { name: "Zoe" });
    row.focus();
    fireEvent.keyDown(row, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "People online" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("dismisses on outside touch without stealing focus", () => {
    const trigger = open();
    trigger.focus();
    const outside = screen.getByRole("button", { name: "Outside" });
    fireEvent.pointerDown(outside, { pointerType: "touch" });
    expect(screen.queryByRole("group", { name: "People online" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("locates a selected player and closes the popover", () => {
    const located = vi.fn();
    const off = bus.on("locate", located);
    const trigger = open();
    fireEvent.click(screen.getByRole("button", { name: "Zoe" }));
    expect(located).toHaveBeenCalledWith({ id: "other" });
    expect(screen.queryByRole("group", { name: "People online" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    off();
  });

  it("keeps the popover open for touches inside and closes on keyboard focus exit", () => {
    open();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Zoe" }), { pointerType: "touch" });
    expect(screen.getByRole("group", { name: "People online" })).toBeTruthy();
    screen.getByRole("button", { name: "Zoe" }).focus();
    act(() => screen.getByRole("button", { name: "Outside" }).focus());
    expect(screen.queryByRole("group", { name: "People online" })).toBeNull();
  });
});
