#!/usr/bin/env python3
"""Generate the wayfinding sign sprites (PRD 22).

Original pixel art authored for this project — wooden signage in the game's
warm-timber accent, cohesive with the existing 16/32px Pipoya-family furniture
PNGs; NOT derived from any third-party pack. Two sprites:

  sign_banner.png  96x28 — a wide hanging nameplate for building entrances.
  sign_post.png    64x60 — a vertical signpost plank for directional junctions.

The name/direction TEXT is NOT baked in — WorldScene draws a crisp text label
from the map object's `text` property (kept aligned with the AREA_NAMES
registry), so a rename never requires re-exporting art.

Writes: public/assets/furniture/sign_{banner,post}.png
Run:  python3 scripts/gen_signs.py
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "assets", "furniture")

# Warm-timber palette (RGBA), cohesive with the cool-office furniture accents.
OUTLINE = (40, 26, 15, 255)     # #281a0f dark edge
WOOD_LO = (96, 62, 34, 255)     # #603e22 shadowed plank
WOOD = (140, 94, 54, 255)       # #8c5e36 plank body
WOOD_HI = (176, 126, 78, 255)   # #b07e4e lit plank grain
POST = (110, 74, 42, 255)       # #6e4a2a support post
IRON = (58, 66, 88, 255)        # #3a4258 hanging bracket (cool accent tie-in)
SHADOW = (0, 0, 0, 55)
CLEAR = (0, 0, 0, 0)


def px(img, x, y, c):
    if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((x, y), c)


def rect(img, x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            px(img, x, y, c)


def plank(img, x0, y0, x1, y1):
    """A framed wooden plank with a lit top edge + shadowed bottom + grain."""
    rect(img, x0, y0, x1, y1, OUTLINE)
    rect(img, x0 + 1, y0 + 1, x1 - 1, y1 - 1, WOOD)
    rect(img, x0 + 1, y0 + 1, x1 - 1, y0 + 1, WOOD_HI)          # lit top
    rect(img, x0 + 1, y1 - 1, x1 - 1, y1 - 1, WOOD_LO)          # shadowed base
    for gx in range(x0 + 2, x1 - 1, 5):                        # sparse grain flecks
        px(img, gx, (y0 + y1) // 2, WOOD_HI)


def banner():
    im = Image.new("RGBA", (96, 28), CLEAR)
    rect(im, 6, 26, 90, 27, SHADOW)                            # ground shadow
    # Two iron brackets the plank "hangs" from.
    rect(im, 12, 1, 13, 6, IRON)
    rect(im, 82, 1, 83, 6, IRON)
    plank(im, 4, 5, 91, 24)
    return im


def post():
    im = Image.new("RGBA", (64, 60), CLEAR)
    rect(im, 26, 57, 37, 59, SHADOW)                          # ground shadow
    rect(im, 30, 8, 33, 58, POST)                             # vertical post
    rect(im, 30, 8, 30, 58, OUTLINE)
    rect(im, 33, 8, 33, 58, OUTLINE)
    plank(im, 3, 6, 60, 34)                                    # arrow plank
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, im in (("banner", banner()), ("post", post())):
        path = os.path.join(OUT, f"sign_{name}.png")
        im.save(path)
        print(f"wrote {path} ({os.path.getsize(path)} bytes)")


if __name__ == "__main__":
    main()
