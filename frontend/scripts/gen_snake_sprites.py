#!/usr/bin/env python3
"""Generate the Snake mini-game sprite sheet (issue #163).

Replaces the flat rounded rectangles the Snake renderer used to draw with real
16x16 pixel-art tiles, in the same cool top-down palette as the arcade cabinets
(scripts/gen_arcade_sprites.py) so the mini-game reads as part of the locked
Pipoya-compatible art direction rather than a canvas doodle.

Output: ../public/assets/arcade/snake_tiles.png — ONE row of 16 tiles:

     0 head->right   1 head->down   2 head->left   3 head->up
     4 body horizontal              5 body vertical
     6 bend up+right 7 bend right+down 8 bend down+left 9 bend left+up
    10 tail->right  11 tail->down  12 tail->left  13 tail->up
    14 food (apple) 15 wall block

The tile order is the contract consumed by src/game/arcade/snakeSprites.ts —
change one and you must change the other (snakeSprites.test.ts pins the indices).

Method: every tile is described as a boolean pixel MASK; the outline is then
derived (a mask pixel with an in-tile neighbour outside the mask). Pixels beyond
the tile border count as "inside", so a band that continues into the neighbouring
tile is not outlined there and long bodies read as one continuous snake.

Requires: Pillow.  Run:  python3 scripts/gen_snake_sprites.py
"""

import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "assets", "arcade")

T = 16  # tile size
N = 16  # tile count

CLEAR = (0, 0, 0, 0)
OUTLINE = (16, 20, 31, 255)      # #10141f — same outline ink as the cabinets
BODY = (70, 168, 146, 255)       # mid green-teal
BODY_HI = (140, 225, 200, 255)   # lit top/left edge
BODY_LO = (44, 112, 100, 255)    # shaded bottom/right edge + scales
HEAD = (143, 240, 214, 255)      # #8ff0d6 — the existing head colour
HEAD_HI = (200, 252, 236, 255)
HEAD_LO = (104, 200, 176, 255)
EYE = (16, 20, 31, 255)
EYE_LIGHT = (232, 236, 245, 255)
APPLE = (224, 86, 122, 255)      # #e0567a — the existing pellet colour
APPLE_HI = (247, 160, 182, 255)
LEAF = (110, 200, 180, 255)
WALL = (58, 71, 103, 255)        # #3a4767 — cool office furniture body
WALL_HI = (86, 102, 143, 255)
WALL_LO = (43, 53, 80, 255)

Mask = set[tuple[int, int]]


def band_h(y0: int, y1: int, x0: int = 0, x1: int = T - 1) -> Mask:
    return {(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)}


def band_v(x0: int, x1: int, y0: int = 0, y1: int = T - 1) -> Mask:
    return {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}


def disc(cx: float, cy: float, r: float) -> Mask:
    return {
        (x, y)
        for y in range(T)
        for x in range(T)
        if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r
    }


def rotate(mask: Mask, quarter_turns: int) -> Mask:
    """Rotate a mask clockwise by 90 degrees, `quarter_turns` times."""
    out = set(mask)
    for _ in range(quarter_turns % 4):
        out = {(T - 1 - y, x) for (x, y) in out}
    return out


def paint(mask: Mask, base, hi, lo, scales: bool) -> Image.Image:
    """Render a mask: derived outline, lit top/left edge, shaded bottom/right.

    Pixels beyond the tile border count as "inside the mask" for the outline
    test (so bands join seamlessly across tiles) but as "not open" for the
    shading tests (so a join never gains a bright or dark seam).
    """

    def open_at(x: int, y: int) -> bool:
        return 0 <= x < T and 0 <= y < T and (x, y) not in mask

    im = Image.new("RGBA", (T, T), CLEAR)
    for (x, y) in mask:
        if any(open_at(nx, ny) for (nx, ny) in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))):
            im.putpixel((x, y), OUTLINE)
            continue
        if open_at(x, y - 2) or open_at(x - 2, y):
            colour = hi
        elif open_at(x, y + 2) or open_at(x + 2, y):
            colour = lo
        elif scales and (x + y) % 5 == 0 and (x * 3 + y) % 4 == 0:
            colour = lo
        else:
            colour = base
        im.putpixel((x, y), colour)
    return im


# The body band is 10px of a 16px tile, leaving a 3px gutter each side so the
# grid still reads through a coiled snake.
BAND_LO, BAND_HI = 3, 12


def body_horizontal() -> Image.Image:
    return paint(band_h(BAND_LO, BAND_HI), BODY, BODY_HI, BODY_LO, True)


def body_vertical() -> Image.Image:
    return paint(band_v(BAND_LO, BAND_HI), BODY, BODY_HI, BODY_LO, True)


def bend_right_down() -> Image.Image:
    """Connects the RIGHT edge and the BOTTOM edge (tile 7)."""
    mask = band_h(BAND_LO, BAND_HI, x0=BAND_LO) | band_v(BAND_LO, BAND_HI, y0=BAND_LO)
    # Round the outer elbow so the corner does not read as a hard block.
    mask -= {(BAND_LO, BAND_LO), (BAND_LO + 1, BAND_LO), (BAND_LO, BAND_LO + 1)}
    return paint(mask, BODY, BODY_HI, BODY_LO, True)


def head_right() -> Image.Image:
    """Head facing RIGHT: neck enters from the left edge (tile 0)."""
    # Neck band up to x=8, then a rounded snout that stops short of x=15 so the
    # head is visibly capped rather than running off the tile.
    mask = band_h(BAND_LO, BAND_HI, x0=0, x1=8) | disc(9.5, 8.0, 5.0)
    im = paint(mask, HEAD, HEAD_HI, HEAD_LO, False)
    # Eyes: 2x2 dark pupils with a single light glint each.
    for top in (5, 9):
        for (ex, ey) in ((10, top), (11, top), (10, top + 1), (11, top + 1)):
            im.putpixel((ex, ey), EYE)
        im.putpixel((11, top), EYE_LIGHT)
    # Nostril dots on the snout.
    im.putpixel((13, 7), OUTLINE)
    im.putpixel((13, 9), OUTLINE)
    return im


def tail_right() -> Image.Image:
    """Tail whose body continues to the RIGHT; the tip tapers left (tile 10)."""
    mask: Mask = set()
    half_max = (BAND_HI - BAND_LO + 1) / 2  # 5.0 — matches the body band
    for x in range(T):
        t = x / (T - 1)
        half = 1.5 + (half_max - 1.5) * t
        top = int(round(8.0 - half))
        bottom = int(round(7.0 + half))
        for y in range(max(0, top), min(T - 1, bottom) + 1):
            mask.add((x, y))
    return paint(mask, BODY, BODY_HI, BODY_LO, True)


def food() -> Image.Image:
    im = Image.new("RGBA", (T, T), CLEAR)
    mask = disc(8.0, 9.0, 5.2)
    for (x, y) in mask:
        neighbours = ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))
        edge = any((nx, ny) not in mask for (nx, ny) in neighbours)
        im.putpixel((x, y), OUTLINE if edge else APPLE)
    # Specular highlight + stem + leaf.
    for p in ((6, 6), (7, 6), (6, 7)):
        im.putpixel(p, APPLE_HI)
    im.putpixel((8, 3), OUTLINE)
    im.putpixel((8, 2), OUTLINE)
    for p in ((9, 2), (10, 2), (9, 1)):
        im.putpixel(p, LEAF)
    return im


def wall() -> Image.Image:
    im = Image.new("RGBA", (T, T), CLEAR)
    for y in range(T):
        for x in range(T):
            im.putpixel((x, y), WALL)
    # Bevel: lit top/left, shaded bottom/right, dark border.
    for i in range(T):
        im.putpixel((i, 0), WALL_HI)
        im.putpixel((0, i), WALL_HI)
        im.putpixel((i, T - 1), OUTLINE)
        im.putpixel((T - 1, i), OUTLINE)
        im.putpixel((i, T - 2), WALL_LO)
        im.putpixel((T - 2, i), WALL_LO)
    # Brick seam so a long wall run does not read as one flat slab.
    for x in range(2, T - 2):
        im.putpixel((x, 8), WALL_LO)
    for y in range(9, T - 2):
        im.putpixel((8, y), WALL_LO)
    return im


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    head_r = head_right()
    tail_r = tail_right()
    bend_rd = bend_right_down()

    tiles: list[Image.Image] = [
        head_r,                                  # 0 head -> right
        head_r.rotate(-90),                      # 1 head -> down
        head_r.rotate(180),                      # 2 head -> left
        head_r.rotate(90),                       # 3 head -> up
        body_horizontal(),                       # 4
        body_vertical(),                         # 5
        bend_rd.rotate(90),                      # 6 bend up+right
        bend_rd,                                 # 7 bend right+down
        bend_rd.rotate(-90),                     # 8 bend down+left
        bend_rd.rotate(180),                     # 9 bend left+up
        tail_r,                                  # 10 tail -> right
        tail_r.rotate(-90),                      # 11 tail -> down
        tail_r.rotate(180),                      # 12 tail -> left
        tail_r.rotate(90),                       # 13 tail -> up
        food(),                                  # 14
        wall(),                                  # 15
    ]
    assert len(tiles) == N, f"expected {N} tiles, built {len(tiles)}"

    sheet = Image.new("RGBA", (T * N, T), CLEAR)
    for i, tile in enumerate(tiles):
        sheet.paste(tile, (i * T, 0))
    path = os.path.join(OUT, "snake_tiles.png")
    sheet.save(path)
    print(f"wrote {path} ({sheet.width}x{sheet.height}, {os.path.getsize(path)} bytes)")


if __name__ == "__main__":
    main()
