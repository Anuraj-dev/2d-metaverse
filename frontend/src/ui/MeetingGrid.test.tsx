import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { charForPlayer } from "../game/chars";

/**
 * Meeting-grid tiles from N mock participants (PRD 10 RTL coverage): tiles,
 * nameplates, and pixel-avatar camera-off fallbacks. The LiveKit room is
 * mocked to null so the grid takes the roster path — the same tiles the
 * connected path renders for camera-off participants (TileBody is shared);
 * the LiveKit-connected arrangement itself comes from @livekit/components-react.
 */
const media = vi.hoisted(() => ({
  roomVideo: {
    lkRoom: null as unknown,
    onRoomChanged: vi.fn(() => () => {}),
    setMicEnabled: vi.fn(),
    setCamEnabled: vi.fn(),
  },
}));
vi.mock("../media/livekit", () => media);

import MeetingGrid from "./MeetingGrid";

const roster = [
  { id: "me", name: "raja" },
  { id: "p2", name: "bob" },
  { id: "p3", name: "carol" },
];

afterEach(() => cleanup());

describe("MeetingGrid (roster fallback — media unavailable)", () => {
  it("renders one tile per participant with username nameplates", () => {
    render(<MeetingGrid participants={roster} selfId="me" />);
    const tiles = screen.getAllByTestId("meet-tile");
    expect(tiles).toHaveLength(3);
    expect(screen.getByText("raja (you)")).toBeTruthy();
    expect(screen.getByText("bob")).toBeTruthy();
    expect(screen.getByText("carol")).toBeTruthy();
  });

  it("shows every camera-less participant as their in-game pixel sprite", () => {
    render(<MeetingGrid participants={roster} selfId="me" />);
    const avatars = screen.getAllByTestId("meet-tile-avatar");
    expect(avatars).toHaveLength(3);
    // Remotes use the deterministic world mapping — the same character the
    // Phaser scene draws for that playerId.
    const bobTile = screen
      .getAllByTestId("meet-tile")
      .find((tile) => tile.getAttribute("data-player") === "p2");
    const bobSprite = bobTile?.querySelector(".pixel-avatar");
    expect(bobSprite?.getAttribute("data-char")).toBe(charForPlayer("p2"));
  });

  it("uses the local player's chosen avatar for their own tile", () => {
    render(<MeetingGrid participants={roster} selfId="me" selfChar="char7" />);
    const selfTile = screen
      .getAllByTestId("meet-tile")
      .find((tile) => tile.getAttribute("data-player") === "me");
    expect(selfTile?.querySelector(".pixel-avatar")?.getAttribute("data-char")).toBe("char7");
  });

  it("marks the grid container for hook-based e2e assertions", () => {
    render(<MeetingGrid participants={roster} selfId="me" />);
    expect(screen.getByTestId("meeting-grid")).toBeTruthy();
  });

  it("renders a solo grid for a single remaining participant", () => {
    render(<MeetingGrid participants={[{ id: "me", name: "raja" }]} selfId="me" />);
    expect(screen.getAllByTestId("meet-tile")).toHaveLength(1);
    expect(screen.getByText("raja (you)")).toBeTruthy();
  });
});
