import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MediaPublicationStatus } from "../media/publicationState";
import { bus } from "../game/eventBus";

const stage = vi.hoisted(() => {
  let status: MediaPublicationStatus = "off";
  const listeners = new Set<() => void>();
  return {
    stageVideo: {
      onPublicationStatus: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getPublicationStatus: () => status,
      onTracks: vi.fn(() => () => {}),
    },
    setStatus(next: MediaPublicationStatus) {
      status = next;
      listeners.forEach((listener) => listener());
    },
  };
});

vi.mock("../media/livekit", () => ({ stageVideo: stage.stageVideo }));

import StageScreen from "./StageScreen";

beforeEach(() => stage.setStatus("off"));
afterEach(cleanup);

describe("StageScreen broadcast status", () => {
  it("shows NOT LIVE on the presenter platform and LIVE only after confirmed publication", () => {
    render(<StageScreen />);
    expect(screen.queryByRole("status")).toBeNull();

    act(() => bus.emit("near-presenter-slot"));
    expect(screen.getByRole("status").textContent).toContain("NOT LIVE");

    act(() => stage.setStatus("live"));
    expect(screen.getByRole("status").textContent).toContain("LIVE");

    // A live broadcast remains explicit even if the player walks off the slot
    // before the server/media teardown completes.
    act(() => bus.emit("leave-presenter-slot"));
    expect(screen.getByRole("status").textContent).toContain("LIVE");
  });

  it("renders one Go Live action with no separate video or on-air action", () => {
    let confirmed = false;
    const off = bus.on("stage-confirm", () => (confirmed = true));
    render(<StageScreen />);

    act(() => bus.emit("stage-prompt-show"));
    expect(screen.getByText("Go live?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go Live" })).toBeTruthy();
    expect(screen.queryByText("Go Live (video)")).toBeNull();
    expect(screen.queryByText("Go on air")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));
    expect(confirmed).toBe(true);
    off();
  });

  it("uses the same prompt for a failed start and emits one stop-live action", () => {
    let stopped = false;
    const off = bus.on("stage-stop", () => (stopped = true));
    render(<StageScreen />);

    act(() => stage.setStatus("denied"));
    act(() => bus.emit("stage-prompt-show"));
    expect(screen.getByRole("alert").textContent).toContain("Couldn't start");
    expect(screen.getByRole("button", { name: "Go Live" })).toBeTruthy();

    act(() => stage.setStatus("live"));
    fireEvent.click(screen.getByRole("button", { name: "Stop Live" }));
    expect(stopped).toBe(true);
    off();
  });
});
