#!/usr/bin/env python3
"""Generate campus.json — the full 120×90 outdoor campus world.

Districts (tile coordinates, inclusive):
  PARK       (NW)  x=1-28,   y=1-55   — grass + trees
  HQ         (N)   x=30-79,  y=1-24   — office shell (rooms added in #11)
  AUDITORIUM (NE)  x=81-118, y=1-44   — stage area (broadcast added in #13)
  PLAZA     (CTR)  x=12-107, y=26-60  — open walkable, spawn at (60,44)
  CAFE       (SW)  x=1-55,   y=62-88  — lounge/social
  COWORKING  (SE)  x=57-118, y=62-88  — open desk pods

Tilesets (matched to MAPS registry in maps.ts):
  floors_walls  firstgid=1   (288×144 px, 18 cols, 162 tiles)
  exterior      firstgid=163 (528×1024 px, 33 cols, 2112 tiles)

Run:  python3 scripts/gen_campus.py
"""

import json
import os

W, H, TS = 120, 90, 16   # cols × rows × px per tile  →  1920×1440 px

# ── Tile GIDs ────────────────────────────────────────────────────────────
# floors_walls.png (firstgid=1)
FLOOR      = 116   # light wood plank — indoor base
FLOOR_ACC  = 48    # tan plank        — indoor accent
WALL       = 9     # dark-brown wall  — collision

# exterior.png (firstgid=163)
# Indices derived from existing campus.json tracer-bullet and visual inspection:
#   exterior tile 0-based idx = gid - 163
GRASS      = 366   # gid 366 = ext idx 203 (row 6, col 5)  — base outdoor ground
STONE      = 269   # gid 269 = ext idx 106 (row 3, col 10) — stone path / plaza
PARK_ACC   = 301   # gid 301 = ext idx 138 (row 4, col 6)  — park accent
CAFE_ACC   = 303   # gid 303 = ext idx 140 (row 4, col 8)  — warm accent tile


def idx(x, y):
    return y * W + x


# Two tile layers (data as flat gid arrays, 0 = empty/transparent)
ground      = [GRASS] * (W * H)
walls_data  = [0]     * (W * H)
decor_above = [0]     * (W * H)    # renders over the player


def fill(layer, x0, y0, x1, y1, tile):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            layer[idx(x, y)] = tile


def wall_rect(x0, y0, x1, y1):
    """Solid-wall perimeter around a rectangle (no interior fill)."""
    for x in range(x0, x1 + 1):
        walls_data[idx(x, y0)] = WALL
        walls_data[idx(x, y1)] = WALL
    for y in range(y0, y1 + 1):
        walls_data[idx(x0, y)] = WALL
        walls_data[idx(x1, y)] = WALL


def door_gap(wx, wy, width=2):
    """Clear wall tiles to make a door opening."""
    for x in range(wx, wx + width):
        walls_data[idx(x, wy)] = 0


# ── Map border ───────────────────────────────────────────────────────────
for x in range(W):
    walls_data[idx(x, 0)]     = WALL
    walls_data[idx(x, H - 1)] = WALL
for y in range(H):
    walls_data[idx(0, y)]     = WALL
    walls_data[idx(W - 1, y)] = WALL

# ── PARK (NW) ────────────────────────────────────────────────────────────
# Grass is already the default; add a subtle accent strip along the east edge
for y in range(1, 56):
    ground[idx(28, y)] = PARK_ACC

# ── CENTRAL PLAZA ────────────────────────────────────────────────────────
fill(ground, 12, 26, 107, 60, STONE)

# ── Main path arteries ───────────────────────────────────────────────────
# E-W artery at y=43–45 (bisects the plaza, continues to park & auditorium)
fill(ground, 1, 43, W - 2, 45, STONE)
# N-S artery at x=56–63 (runs from HQ entrance to cafe/coworking)
fill(ground, 56, 1, 63, H - 2, STONE)
# N-S park path at x=29 connecting park to plaza
fill(ground, 29, 1, 30, H - 2, STONE)
# N-S east path at x=79–80 connecting auditorium to plaza/coworking
fill(ground, 79, 1, 80, H - 2, STONE)

# ── HQ BUILDING (N-center) ───────────────────────────────────────────────
fill(ground, 31, 2, 78, 23, FLOOR)        # interior floor
wall_rect(30, 1, 79, 24)                   # perimeter walls
door_gap(49, 24, width=2)                  # south entrance left gap
door_gap(58, 24, width=2)                  # south entrance right gap

# ── AUDITORIUM (NE) ──────────────────────────────────────────────────────
fill(ground, 82, 2, 117, 43, CAFE_ACC)    # interior accent floor
wall_rect(81, 1, 118, 44)                  # perimeter walls
door_gap(98, 44, width=2)                  # south entrance

# ── CAFE / LOUNGE (SW) ───────────────────────────────────────────────────
fill(ground, 1, 62, 55, 88, PARK_ACC)     # warm accent ground

# ── COWORKING (SE) ───────────────────────────────────────────────────────
fill(ground, 57, 62, 118, 88, FLOOR_ACC)  # indoor accent ground

# ── SPAWN ────────────────────────────────────────────────────────────────
SPAWN_TX, SPAWN_TY = 60, 44              # center of plaza, on the E-W artery
spawn_obj = {
    "id": 1, "name": "spawn",
    "x": SPAWN_TX * TS, "y": SPAWN_TY * TS,
    "width": 0, "height": 0,
    "point": True, "rotation": 0, "type": "", "visible": True,
    "properties": [],
}

# ── FURNITURE objects ─────────────────────────────────────────────────────
furniture = []


def furn(key, tx, ty, solid):
    furniture.append({
        "id": 20000 + len(furniture),
        "name": key,
        "x": tx * TS + TS // 2,
        "y": ty * TS + TS // 2,
        "point": True,
        "rotation": 0, "type": "", "visible": True,
        "properties": [
            {"name": "key",   "type": "string", "value": key},
            {"name": "solid", "type": "bool",   "value": bool(solid)},
        ],
    })


# Park — trees and plants scattered across the green zone
for tx, ty in [(4,4),(8,8),(12,4),(16,8),(20,4),(24,9),
               (6,14),(11,18),(16,14),(22,18),(5,23),
               (10,28),(15,23),(20,28),(25,23),
               (3,33),(8,38),(13,33),(18,38),(25,38),
               (3,47),(10,47),(17,47),(24,47)]:
    furn("f_plant_big", tx, ty, True)
for tx, ty in [(6,6),(14,11),(21,6),(9,20),(18,24),
               (6,30),(14,35),(22,30),(7,40),(20,42),
               (5,50),(12,52),(19,50)]:
    furn("f_plant_small", tx, ty, False)

# Plaza — welcome desk, water cooler, landmark plants, clock
furn("f_desk",  16, 38, True)
furn("f_chair", 16, 39, False)
furn("f_water", 65, 33, True)
furn("f_clock", 95, 30, False)
for tx, ty in [(14, 28), (14, 58), (105, 28), (105, 58)]:
    furn("f_plant_big", tx, ty, True)

# Cafe — round tables + chairs in a grid, plus bar items on the west wall
for tx, ty in [(8,65),(8,71),(8,77),
               (15,65),(15,71),(15,77),
               (22,65),(22,71),(22,77),
               (29,65),(29,71),(29,77),
               (36,65),(36,71),(36,77),
               (44,65),(44,71),(44,77)]:
    furn("f_table_small", tx, ty, False)
    furn("f_chair",       tx, ty + 1, False)
    furn("f_chair_side",  tx + 1, ty, False)
furn("f_vending",  2, 65, True)
furn("f_water",    2, 69, True)
furn("f_coffee",   2, 73, False)
furn("f_sofa",     47, 82, True)
furn("f_sofa_small", 50, 82, True)
for tx, ty in [(2, 85), (52, 65)]:
    furn("f_plant_big", tx, ty, True)

# Coworking — desk pods in two rows
for tx, ty in [(60,65),(67,65),(74,65),(81,65),(88,65),(95,65),(102,65)]:
    furn("f_desk",  tx, ty, True)
    furn("f_chair", tx, ty + 1, False)
for tx, ty in [(60,73),(67,73),(74,73),(81,73),(88,73),(95,73)]:
    furn("f_desk2", tx, ty, True)
    furn("f_chair", tx, ty + 1, False)
furn("f_desk_boss",    102, 73, True)
furn("f_chair_boss",   102, 74, False)
furn("f_bookshelf_tall", 58, 63, True)
furn("f_bookshelf_tall", 58, 80, True)
for tx, ty in [(115, 63), (115, 80)]:
    furn("f_plant_small", tx, ty, False)

# Auditorium — podium, clock, stage plants, audience rows
furn("f_table_round", 99, 10, True)
furn("f_clock",       99,  7, False)
for tx, ty in [(83, 2), (115, 2), (83, 42), (115, 42)]:
    furn("f_plant_big", tx, ty, True)
for ry in (20, 23, 26, 29, 32):
    for rx in range(84, 116, 3):
        furn("f_chair", rx, ry, False)

# HQ lobby — welcome desk + plants by entrance
furn("f_desk",       54, 20, True)
furn("f_chair",      54, 21, False)
furn("f_plant_big",  32,  3, True)
furn("f_plant_big",  77,  3, True)
furn("f_bookshelf_tall", 32, 10, True)
furn("f_bookshelf_tall", 77, 10, True)

# ── Tilemap JSON ──────────────────────────────────────────────────────────
tilemap = {
    "compressionlevel": -1,
    "infinite": False,
    "width": W, "height": H,
    "tilewidth": TS, "tileheight": TS,
    "orientation": "orthogonal",
    "renderorder": "right-down",
    "type": "map",
    "version": "1.10",
    "tiledversion": "1.10.2",
    "nextlayerid": 12,
    "nextobjectid": 30000,
    "tilesets": [
        {
            "firstgid": 1, "name": "floors_walls",
            "image": "../tilesets/floors_walls.png",
            "imagewidth": 288, "imageheight": 144,
            "tilewidth": 16, "tileheight": 16,
            "tilecount": 162, "columns": 18,
            "margin": 0, "spacing": 0,
        },
        {
            "firstgid": 163, "name": "exterior",
            "image": "../tilesets/exterior.png",
            "imagewidth": 528, "imageheight": 1024,
            "tilewidth": 16, "tileheight": 16,
            "tilecount": 2112, "columns": 33,
            "margin": 0, "spacing": 0,
        },
    ],
    "layers": [
        {"id": 1,  "name": "ground",      "type": "tilelayer",  "visible": True,
         "opacity": 1, "x": 0, "y": 0, "width": W, "height": H, "data": ground},
        {"id": 2,  "name": "walls",       "type": "tilelayer",  "visible": True,
         "opacity": 1, "x": 0, "y": 0, "width": W, "height": H, "data": walls_data},
        {"id": 9,  "name": "decor_above", "type": "tilelayer",  "visible": True,
         "opacity": 1, "x": 0, "y": 0, "width": W, "height": H, "data": decor_above},
        {"id": 3,  "name": "doorZones",   "type": "objectgroup", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "draworder": "topdown", "objects": []},
        {"id": 4,  "name": "seats",       "type": "objectgroup", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "draworder": "topdown", "objects": []},
        {"id": 7,  "name": "roomBounds",  "type": "objectgroup", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "draworder": "topdown", "objects": []},
        {"id": 6,  "name": "furniture",   "type": "objectgroup", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "draworder": "topdown", "objects": furniture},
        {"id": 5,  "name": "spawn",       "type": "objectgroup", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "draworder": "topdown",
         "objects": [spawn_obj]},
    ],
}

out = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "public", "assets", "maps", "campus.json")
)
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as f:
    json.dump(tilemap, f)

wall_count   = sum(1 for t in walls_data  if t)
ground_tiles = {t for t in ground if t}
print(f"wrote {out}")
print(f"  {W}×{H} tiles = {W*TS}×{H*TS} px")
print(f"  ground tile types: {sorted(ground_tiles)}")
print(f"  wall tiles placed: {wall_count}")
print(f"  furniture objects: {len(furniture)}")
print(f"  spawn @ tile ({SPAWN_TX},{SPAWN_TY}) = px ({SPAWN_TX*TS},{SPAWN_TY*TS})")
