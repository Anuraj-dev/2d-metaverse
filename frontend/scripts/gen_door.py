#!/usr/bin/env python3
"""Compose public/assets/doors/door1.png — the meeting-room door spritesheet.

Cut from the Top-Down Retro Interior `doors_windows.png` tileset (already
shipped in public/assets/tilesets/, same art family as the walls/floors), so
the door is 16px-native and style-matched — replacing the earlier RPG-Maker
density Pipoya sheet whose 48x96 cells rendered misaligned beside the doorway
(PRD 12 graphics bug: "door-frame sprite floats beside doorways").

Sheet layout: 3 frames of 32x48, bottom-aligned on the doorway:
  frame 0  door frame + closed leaf
  frame 1  door frame + ajar leaf (hinge on the left jamb)
  frame 2  door frame only (open — the frame keeps dressing the doorway)

WorldScene places the sprite with origin (0.5, 1) at the doorway rect's
bottom-center, so the door sits IN the 2-tile door gap and the lintel rises
one tile above the wall row.

Run:  python3 scripts/gen_door.py
"""

import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TILESETS = os.path.join(HERE, "..", "public", "assets", "tilesets")
OUT = os.path.join(HERE, "..", "public", "assets", "doors", "door1.png")

# Source sprite boxes inside doors_windows.png (alpha-measured, warm-wood set).
FRAME_BOX = (97, 0, 127, 48)     # 30x48 door frame, transparent opening
CLOSED_BOX = (131, 2, 157, 48)   # 26x46 closed leaf
AJAR_BOX = (163, 2, 185, 48)     # 22x46 ajar leaf, hinge at left edge

FRAME_W, FRAME_H = 32, 48

src = Image.open(os.path.join(TILESETS, "doors_windows.png")).convert("RGBA")
frame = src.crop(FRAME_BOX)
closed = src.crop(CLOSED_BOX)
ajar = src.crop(AJAR_BOX)

sheet = Image.new("RGBA", (FRAME_W * 3, FRAME_H), (0, 0, 0, 0))


def put(i: int, leaf: Image.Image | None) -> None:
    cell = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    cell.alpha_composite(frame, (1, 0))  # 30 wide, centered in 32
    if leaf is not None:
        # leaves sit inside the frame opening, hinge on the left jamb
        cell.alpha_composite(leaf, (3, 2))
    sheet.alpha_composite(cell, (i * FRAME_W, 0))


put(0, closed)
put(1, ajar)
put(2, None)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
sheet.save(OUT, optimize=True)
print(f"wrote {os.path.abspath(OUT)}  ({sheet.size[0]}x{sheet.size[1]}, 3 frames of {FRAME_W}x{FRAME_H})")
