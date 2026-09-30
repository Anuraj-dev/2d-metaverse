import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import FlappyGame from "./FlappyGame";

describe("FlappyGame accessibility", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  it("names the canvas with click and keyboard flap controls", () => {
    render(
      <FlappyGame
        seed={1}
        paused={false}
        shake={false}
        onScore={() => {}}
        onGameOver={() => {}}
      />,
    );
    expect(
      screen.getByRole("img", { name: /Flappy.*Click or press Space/i }),
    ).toBeTruthy();
  });
});
