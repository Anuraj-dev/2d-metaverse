#!/usr/bin/env python3
"""Generate the Tiled JSON map for the metaverse — a themed campus.

Zones: garden (top-left), meeting wing with 3 key-gated rooms (top-right),
plaza/spawn (centre-left), cafe (centre-right), coworking (bottom-left), and an
auditorium/stage (bottom-right). Meeting rooms are enclosed with a door; the rest
is one open, walkable floor whose zones read through accent flooring + furniture.

Tileset: TopDownHouse floors_walls.png (18x9 @16px, indices 0-161; Tiled gid =
index+1). Furniture is emitted as a `furniture` object layer (key + solid flag) and
instantiated from the individual f_* PNGs by WorldScene — no extra tileset needed.
Refine visually in the Tiled editor later. Run: python3 scripts/gen_map.py
"""
import json
import os

W, H, TS = 80, 56, 16          # cols, rows, tile size  -> 1280 x 896 px
FLOOR = 116                    # light wood plank (index 115)
ACCENT = 48                    # tan plank (index 47) — room / zone floor
WALL = 9                       # dark-brown wall (index 8)


def idx(x, y):
    return y * W + x


ground = [FLOOR] * (W * H)
walls = [0] * (W * H)

# outer border ring
for x in range(W):
    walls[idx(x, 0)] = WALL
    walls[idx(x, H - 1)] = WALL
for y in range(H):
    walls[idx(0, y)] = WALL
    walls[idx(W - 1, y)] = WALL


def fill_floor(x0, y0, x1, y1, tile):
    for y in range(y0, y1):
        for x in range(x0, x1):
            ground[idx(x, y)] = tile


rooms = []   # gated meeting rooms -> doorZones + seats


def make_room(rid, name, x0, y0, x1, y1, door_x):
    """Enclosed accent-floored room [x0..x1]x[y0..y1] sharing outer walls on the
    border. Bottom wall at y1 with a 2-tile door gap at door_x..door_x+1. Four
    seats around a central table."""
    fill_floor(x0, y0, x1, y1, ACCENT)
    for y in range(y0, y1 + 1):
        if x1 < W - 1:
            walls[idx(x1, y)] = WALL
        if x0 > 0:
            walls[idx(x0, y)] = WALL
    for x in range(x0, x1 + 1):
        if x in (door_x, door_x + 1):
            continue
        walls[idx(x, y1)] = WALL
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    seat_tiles = [(cx - 2, cy, "right"), (cx + 2, cy, "left"),
                  (cx, cy - 2, "down"), (cx, cy + 1, "up")]
    seats = []
    for i, (sx, sy, facing) in enumerate(seat_tiles):
        seats.append({
            "id": 1000 * rid + i,
            "name": f"seat{i}",
            "x": sx * TS, "y": sy * TS, "width": TS, "height": TS,
            "point": False,
            "properties": [
                {"name": "roomId", "type": "string", "value": str(rid)},
                {"name": "seatId", "type": "int", "value": i},
                {"name": "facing", "type": "string", "value": facing},
            ],
        })
    door = {
        "id": 9000 + rid, "name": name,
        "x": door_x * TS, "y": y1 * TS, "width": 2 * TS, "height": TS,
        "properties": [{"name": "roomId", "type": "string", "value": str(rid)}],
    }
    # interior footprint incl. the door row — used to detect genuine room exit
    bounds = {
        "id": 8000 + rid, "name": f"{name} bounds",
        "x": x0 * TS, "y": y0 * TS,
        "width": (x1 - x0) * TS, "height": (y1 - y0 + 1) * TS,
        "properties": [{"name": "roomId", "type": "string", "value": str(rid)}],
    }
    rooms.append({"id": rid, "name": name, "door": door, "seats": seats, "bounds": bounds})


# --- meeting wing: three flush, key-gated rooms along the top-right ---
make_room(1, "Meeting Room A", 31, 1, 44, 12, door_x=36)
make_room(2, "Meeting Room B", 44, 1, 57, 12, door_x=49)
make_room(3, "Meeting Room C", 57, 1, 70, 12, door_x=62)

# --- zone accent flooring (no walls — open campus) ---
fill_floor(50, 18, 78, 37, ACCENT)   # cafe
fill_floor(34, 40, 78, 55, ACCENT)   # auditorium / stage


# --- furniture (decor) as a point object layer: (key, tile_x, tile_y, solid) ---
furniture = []


def furn(key, tx, ty, solid):
    furniture.append({
        "id": 20000 + len(furniture),
        "name": key,
        "x": tx * TS + TS // 2, "y": ty * TS + TS // 2,
        "point": True,
        "properties": [
            {"name": "key", "type": "string", "value": key},
            {"name": "solid", "type": "bool", "value": bool(solid)},
        ],
    })


# garden (top-left): trees & plants
for (tx, ty) in [(4, 3), (9, 6), (15, 3), (22, 5), (26, 11),
                 (6, 13), (13, 14), (20, 13), (27, 16)]:
    furn("f_plant_big", tx, ty, True)
for (tx, ty) in [(11, 9), (18, 10), (24, 3), (3, 9), (16, 6)]:
    furn("f_plant_small", tx, ty, False)

# plaza (centre-left): open, with a welcome desk + landmark plants
furn("f_desk", 7, 21, True)
furn("f_chair", 7, 22, False)
furn("f_water", 5, 25, True)
furn("f_clock", 24, 17, False)
for (tx, ty) in [(3, 20), (3, 35), (46, 20), (46, 35)]:
    furn("f_plant_big", tx, ty, True)

# cafe (centre-right)
furn("f_vending", 52, 20, True)
furn("f_water", 52, 23, True)
furn("f_coffee", 52, 26, False)
furn("f_bookshelf", 54, 35, True)
for (tx, ty) in [(58, 22), (64, 22), (58, 29), (64, 29)]:
    furn("f_table_small", tx, ty, False)
    furn("f_chair", tx, ty + 1, False)
    furn("f_chair_side", tx + 1, ty, False)
furn("f_sofa", 71, 31, True)
furn("f_sofa_small", 75, 31, True)
for (tx, ty) in [(76, 20), (76, 35)]:
    furn("f_plant_big", tx, ty, True)

# coworking (bottom-left): desk pods, each with a chair
for (tx, ty) in [(6, 44), (12, 44), (18, 44), (24, 44)]:
    furn("f_desk", tx, ty, True)
    furn("f_chair", tx, ty + 1, False)
for (tx, ty) in [(6, 49), (12, 49), (18, 49)]:
    furn("f_desk2", tx, ty, True)
    furn("f_chair", tx, ty + 1, False)
furn("f_desk_boss", 24, 49, True)
furn("f_chair_boss", 24, 50, False)
furn("f_bookshelf_tall", 2, 42, True)
furn("f_bookshelf_tall", 2, 52, True)
furn("f_plant_small", 29, 45, False)
furn("f_plant_small", 29, 51, False)

# auditorium / stage (bottom-right): podium + audience rows facing the stage
furn("f_clock", 56, 41, False)
furn("f_table_round", 56, 43, True)   # podium
furn("f_plant_big", 36, 42, True)
furn("f_plant_big", 76, 42, True)
for ry in (48, 50, 52):
    for rx in range(40, 73, 4):
        furn("f_chair", rx, ry, False)

doorZones = [r["door"] for r in rooms]
roomBounds = [r["bounds"] for r in rooms]
seats = [s for r in rooms for s in r["seats"]]
spawn = {"id": 19999, "name": "spawn", "x": 24 * TS, "y": 30 * TS,
         "width": TS, "height": TS, "point": True, "properties": []}

tilemap = {
    "compressionlevel": -1, "infinite": False,
    "width": W, "height": H, "tilewidth": TS, "tileheight": TS,
    "orientation": "orthogonal", "renderorder": "right-down",
    "type": "map", "version": "1.10", "tiledversion": "1.10.2",
    "nextlayerid": 8, "nextobjectid": 30000,
    "tilesets": [{
        "firstgid": 1, "name": "floors_walls",
        "image": "../tilesets/floors_walls.png",
        "imagewidth": 288, "imageheight": 144,
        "tilewidth": 16, "tileheight": 16,
        "tilecount": 162, "columns": 18, "margin": 0, "spacing": 0,
    }],
    "layers": [
        {"id": 1, "name": "ground", "type": "tilelayer", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "width": W, "height": H, "data": ground},
        {"id": 2, "name": "walls", "type": "tilelayer", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "width": W, "height": H, "data": walls},
        {"id": 3, "name": "doorZones", "type": "objectgroup", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "objects": doorZones},
        {"id": 4, "name": "seats", "type": "objectgroup", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "objects": seats},
        {"id": 7, "name": "roomBounds", "type": "objectgroup", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "objects": roomBounds},
        {"id": 6, "name": "furniture", "type": "objectgroup", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "objects": furniture},
        {"id": 5, "name": "spawn", "type": "objectgroup", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "objects": [spawn]},
    ],
}

out = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "maps", "space.json")
out = os.path.abspath(out)
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as f:
    json.dump(tilemap, f)
print("wrote", out, "|", W, "x", H, "tiles | rooms:", len(rooms),
      "| seats:", len(seats), "| furniture:", len(furniture))
