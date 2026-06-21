#!/usr/bin/env python3
"""Generate a starter Tiled JSON map for the metaverse space.
Tileset: TopDownHouse floors_walls.png (18x9 @16px, indices 0-161; Tiled gid = index+1).
This is a STARTER layout meant to be refined visually in the Tiled editor later.
"""
import json, os

W, H, TS = 40, 25, 16          # cols, rows, tile size
FLOOR  = 116                   # light wood plank (index 115)
ACCENT = 48                    # tan plank room floor (index 47)
WALL   = 9                     # dark-brown wall (index 8)

def blank(): return [0] * (W * H)
def idx(x, y): return y * W + x

ground = [FLOOR] * (W * H)
walls  = blank()

# outer border ring
for x in range(W):
    walls[idx(x, 0)] = WALL
    walls[idx(x, H - 1)] = WALL
for y in range(H):
    walls[idx(0, y)] = WALL
    walls[idx(W - 1, y)] = WALL

rooms = []   # for object layer + seats

def make_room(rid, name, x0, y0, x1, y1, door_x):
    """Enclosed room [x0..x1]x[y0..y1] sharing outer walls where on the edge.
    Bottom wall at y1 with a 2-tile door gap at door_x..door_x+1."""
    # accent floor inside
    for y in range(y0, y1):
        for x in range(x0, x1):
            ground[idx(x, y)] = ACCENT
    # right partition
    for y in range(y0, y1 + 1):
        if x1 < W - 1:
            walls[idx(x1, y)] = WALL
    # left partition (only if not on outer border)
    for y in range(y0, y1 + 1):
        if x0 > 0:
            walls[idx(x0, y)] = WALL
    # bottom partition with door gap
    for x in range(x0, x1 + 1):
        if x in (door_x, door_x + 1):
            continue
        walls[idx(x, y1)] = WALL
    # 4 seats around a central table
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    seat_tiles = [(cx - 2, cy, 'right'), (cx + 2, cy, 'left'),
                  (cx, cy - 2, 'down'),  (cx, cy + 1, 'up')]
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
    rooms.append({"id": rid, "name": name, "door": door, "seats": seats})

make_room(1, "Meeting Room A", 1, 1, 13, 9, door_x=6)
make_room(2, "Meeting Room B", 26, 1, 38, 9, door_x=31)

doorZones = [r["door"] for r in rooms]
seats = [s for r in rooms for s in r["seats"]]

tilemap = {
    "compressionlevel": -1, "infinite": False,
    "width": W, "height": H, "tilewidth": TS, "tileheight": TS,
    "orientation": "orthogonal", "renderorder": "right-down",
    "type": "map", "version": "1.10", "tiledversion": "1.10.2",
    "nextlayerid": 6, "nextobjectid": 20000,
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
        {"id": 5, "name": "spawn", "type": "objectgroup", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "objects": [
            {"id": 19999, "name": "spawn", "x": 20 * TS, "y": 18 * TS,
             "width": TS, "height": TS, "point": True, "properties": []}]},
    ],
}

out = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "maps", "space.json")
out = os.path.abspath(out)
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as f:
    json.dump(tilemap, f)
print("wrote", out, "| rooms:", len(rooms), "seats:", len(seats))
