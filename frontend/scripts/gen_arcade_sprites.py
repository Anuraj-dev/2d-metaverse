#!/usr/bin/env python3
"""Generate the arcade-cabinet furniture sprites (PRD 11).

Original pixel art authored for this project — a 32x32 top-down-ish upright
arcade cabinet in the game's cool-office palette, one variant per game (the
marquee + screen glow is tinted per cabinet). Cohesive with the existing 16/32px
Pipoya-family furniture PNGs; NOT derived from any third-party pack.

Writes: public/assets/furniture/arcade_{snake,flappy}.png
Run:  python3 scripts/gen_arcade_sprites.py
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "assets", "furniture")

# Shared palette (RGBA).
OUTLINE = (16, 20, 31, 255)      # #10141f
BODY = (43, 53, 80, 255)         # #2b3550
BODY_HI = (58, 71, 103, 255)     # #3a4767 front face
BODY_LO = (30, 38, 60, 255)      # side shade
PANEL = (74, 87, 118, 255)       # control panel
SCREEN_BG = (10, 14, 24, 255)    # dark screen
MARQUEE = (232, 236, 245, 255)   # #e8ecf5
SHADOW = (0, 0, 0, 60)
CLEAR = (0, 0, 0, 0)

# Per-game accent (marquee tint + screen glow).
ACCENTS = {
    "snake": (127, 209, 185, 255),   # teal  #7fd1b9
    "flappy": (242, 193, 78, 255),   # amber #f2c14e
}


def px(img, x, y, c):
    if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((x, y), c)


def rect(img, x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            px(img, x, y, c)


def cabinet(accent):
    im = Image.new("RGBA", (32, 32), CLEAR)
    # Floor shadow.
    rect(im, 8, 29, 23, 30, SHADOW)
    rect(im, 10, 30, 21, 30, SHADOW)

    # Body block (x 9..22, y 3..29) with outline.
    rect(im, 9, 3, 22, 29, OUTLINE)
    rect(im, 10, 4, 21, 28, BODY)
    # Right side shade for a hint of depth.
    rect(im, 19, 4, 21, 28, BODY_LO)
    # Front face.
    rect(im, 10, 4, 18, 28, BODY_HI)

    # Marquee band (lit accent) y 4..6.
    rect(im, 10, 4, 21, 6, accent)
    rect(im, 11, 5, 20, 5, MARQUEE)

    # Screen bezel + screen y 8..15.
    rect(im, 10, 8, 21, 15, OUTLINE)
    rect(im, 11, 9, 20, 14, SCREEN_BG)
    # Screen glow: accent scanline + a couple pixels.
    glow = (accent[0], accent[1], accent[2], 200)
    rect(im, 12, 10, 19, 10, glow)
    rect(im, 12, 12, 15, 13, glow)
    px(im, 18, 12, accent)

    # Control panel (angled lighter shelf) y 17..20.
    rect(im, 10, 17, 21, 20, PANEL)
    rect(im, 10, 17, 21, 17, OUTLINE)
    # Two buttons.
    px(im, 13, 19, accent)
    px(im, 12, 19, OUTLINE)
    px(im, 17, 19, MARQUEE)
    px(im, 18, 19, OUTLINE)

    # Coin/base panel y 22..28.
    rect(im, 12, 24, 19, 25, BODY_LO)
    rect(im, 15, 24, 16, 25, MARQUEE)  # coin slot glint

    # Little feet.
    px(im, 10, 29, OUTLINE)
    px(im, 21, 29, OUTLINE)
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    for game, accent in ACCENTS.items():
        img = cabinet(accent)
        path = os.path.join(OUT, f"arcade_{game}.png")
        img.save(path)
        print(f"wrote {path} ({os.path.getsize(path)} bytes)")


if __name__ == "__main__":
    main()
