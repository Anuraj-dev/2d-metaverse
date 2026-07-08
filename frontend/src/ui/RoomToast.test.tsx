import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { bus } from "../game/eventBus";
import RoomToast from "./RoomToast";

/**
 * The room-entry toast (PRD 22) resolves the entered room id to its AREA_NAMES
 * display name and shows a brief "Entered <room>" cue, clearing on room exit.
 */
describe("RoomToast", () => {
  afterEach(cleanup);

  it("shows the room's registry display name on entry", () => {
    render(<RoomToast />);
    expect(screen.queryByRole("status")).toBeNull();

    act(() => bus.emit("room-entered", { roomId: "4" }));
    const toast = screen.getByRole("status");
    expect(toast.textContent).toContain("Cauvery Hostel · Room 4");
  });

  it("clears when the player leaves the room", () => {
    render(<RoomToast />);
    act(() => bus.emit("room-entered", { roomId: "1" }));
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => bus.emit("room-left", { roomId: "1" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
