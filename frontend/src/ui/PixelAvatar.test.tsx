import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import PixelAvatar from "./PixelAvatar";
import { charForPlayer } from "../game/chars";
import { FRAME_W, FRAME_H, idleFrame } from "../game/avatar";

afterEach(() => cleanup());

describe("PixelAvatar", () => {
  it("crops the idle-pose frame (facing down) out of the character sheet", () => {
    const scale = 3;
    const { container } = render(<PixelAvatar playerId="p1" scale={scale} />);
    const el = container.querySelector(".pixel-avatar") as HTMLElement;
    const frame = idleFrame("down");
    const col = frame % 3;
    const row = Math.floor(frame / 3);
    expect(el.style.width).toBe(`${FRAME_W * scale}px`);
    expect(el.style.height).toBe(`${FRAME_H * scale}px`);
    expect(el.style.backgroundPosition).toBe(`${-col * FRAME_W * scale}px ${-row * FRAME_H * scale}px`);
    expect(el.style.backgroundImage).toContain(`/assets/characters/${charForPlayer("p1")}.png`);
  });

  it("honors an explicit character override (the local player's chosen avatar)", () => {
    const { container } = render(<PixelAvatar playerId="p1" char="char9" />);
    const el = container.querySelector(".pixel-avatar") as HTMLElement;
    expect(el.getAttribute("data-char")).toBe("char9");
    expect(el.style.backgroundImage).toContain("/assets/characters/char9.png");
  });

  it("falls back to the deterministic world mapping for an unknown override", () => {
    const { container } = render(<PixelAvatar playerId="p1" char="not-a-char" />);
    const el = container.querySelector(".pixel-avatar") as HTMLElement;
    expect(el.getAttribute("data-char")).toBe(charForPlayer("p1"));
  });
});
