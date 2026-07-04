#!/usr/bin/env python3
"""Generate campus.json — the full 120×90 outdoor campus world.

Districts (tile coordinates, inclusive):
  PARK       (NW)  x=1-28,   y=1-55   — grass + trees
  HQ         (N)   x=30-79,  y=1-24   — office shell (rooms 4-6)
  AUDITORIUM (NE)  x=81-118, y=1-44   — stage area (broadcast added in #13)
  PLAZA     (CTR)  x=12-107, y=26-60  — open walkable, spawn at (60,44)
  CAFE       (SW)  x=1-55,   y=62-88  — lounge/social
  COWORKING  (SE)  x=57-118, y=62-88  — open desk pods
  HOSTEL     (S)   x=10-52,  y=93-110 — residential wing, private rooms 1-3
                                        (north facade + courtyard, PRD 13)

Tilesets (matched to MAPS registry in maps.ts):
  floors_walls  firstgid=1   (288×144 px, 18 cols, 162 tiles)
  exterior      firstgid=163 (528×1024 px, 33 cols, 2112 tiles)

Run:  python3 scripts/gen_campus.py
"""

import json
import os
import random

rng = random.Random(12)  # deterministic scatter — regeneration is reproducible

W, H, TS = 120, 118, 16  # cols × rows × px per tile  →  1920×1888 px
                         # (grown south of the plaza for the hostel wing, PRD 13)

# ── Tile GIDs ────────────────────────────────────────────────────────────
# floors_walls.png (firstgid=1)
FLOOR      = 116   # light wood plank — indoor base
FLOOR_ACC  = 48    # tan plank        — indoor accent
FLOOR_HERR = 92    # brown herringbone plank (idx 91) — auditorium floor
FLOOR_MOSS = 39    # olive checkered floor (idx 38)   — meeting-room carpet
WALL       = 69    # brick wall (floors_walls idx 68) — collision.
                   # NB: idx 8 (old GID 9) was a thin trim strip that rendered
                   # as broken brown stripes — see PRD 12 bug #1.

# exterior.png (firstgid=163); exterior tile 0-based idx = gid - 163.
# Every index below was verified with single-tile crops (PRD 12 fix round 1):
# the OLD "STONE"/accent gids (269/301/303) are actually grass-variant tiles —
# which is why the whole campus rendered as one monotonous green field.
GRASS      = 366   # idx 203 — plain base grass
GRASS_T1   = 269   # idx 106 — grass, light tuft sprinkle
GRASS_T2   = 270   # idx 107 — grass, denser tuft cluster
GRASS_T3   = 271   # idx 108 — grass, scattered tufts
GRASS_T4   = 1915  # idx 1752 — grass, fourth tuft pattern
GRASS_SPR1 = 301   # idx 138 — grass with a tiny orange sprout
GRASS_SPR2 = 303   # idx 140 — grass with a thin stem

# Real stone plaza/path family (rows 53-55 of exterior.png): a seamless
# cracked-stone fill plus edge/corner trims that carry the grass transition.
STONE      = 1946  # idx 1783 — solid cracked-stone fill
ST_NW, ST_N, ST_NE = 1912, 1913, 1914   # idx 1749-1751 top corners/edge
ST_W,          ST_E = 1945,       1947  # idx 1782 / 1784 side edges
ST_SW, ST_S, ST_SE = 1978, 1979, 1980   # idx 1815-1817 bottom corners/edge
# inverse 2×2 patch: a grass clearing set into stone (plaza texture breaks)
CLR_NW, CLR_NE, CLR_SW, CLR_SE = 1948, 1949, 1981, 1982  # idx 1785/1786/1818/1819

# Transparent flower overlays for the ground_decor layer
FLOWER_RED    = 204  # idx 41 — orange/red diamond flower
FLOWER_BLUE   = 205  # idx 42 — blue/green flower
FLOWER_PALE   = 237  # idx 74 — pale-blue diamond flower
FLOWER_SMALL  = 172  # idx 9  — small orange blossom

# Trees (canopy → decor_above, trunk → walls for collision, shadow → ground_decor)
# Small tree: 3 cols × 4 rows, top-left idx 792. Big tree: 4 cols × 4 rows, idx 795.
TREE_SMALL = [[955, 956, 957], [988, 989, 990], [1021, 1022, 1023], [1054, 1055, 1056]]
TREE_BIG   = [[958, 959, 960, 961], [991, 992, 993, 994],
              [1024, 1025, 1026, 1027], [1057, 1058, 1059, 1060]]
# trunk gids (row 2 of each block) — the walls-layer guard test allows exactly these
TRUNK_GIDS = sorted(TREE_SMALL[2] + TREE_BIG[2])


def idx(x, y):
    return y * W + x


# Tile layers (data as flat gid arrays, 0 = empty/transparent)
ground       = [GRASS] * (W * H)
ground_decor = [0]     * (W * H)   # overlays under the player (flowers, shadows)
walls_data   = [0]     * (W * H)
decor_above  = [0]     * (W * H)   # renders over the player (tree canopies)


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

# ── CENTRAL PLAZA (real stone now — the old gid was a grass tile) ────────
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
fill(ground, 82, 2, 117, 43, FLOOR_ACC)   # tan plank hall floor
fill(ground, 90, 2, 110, 15, FLOOR_HERR)  # herringbone stage apron (presenter zone)
wall_rect(81, 1, 118, 44)                  # perimeter walls
door_gap(98, 44, width=2)                  # south entrance

# ── CAFE / LOUNGE (SW) ───────────────────────────────────────────────────
# A stone terrace under the table grid, grass margins with flowers around it.
fill(ground, 5, 63, 47, 80, STONE)

# ── COWORKING (SE) ───────────────────────────────────────────────────────
fill(ground, 57, 62, 118, 88, FLOOR_ACC)  # open-air wood deck

# ── PRIVATE MEETING ROOMS IN HQ ──────────────────────────────────────────────
# 3 keyed rooms (IDs 4, 5, 6) along the north interior wall of the HQ building.
# Each room: 13×10 outer tiles with a 2-tile door gap on the south wall.
door_zones  = []
room_bounds = []
seats_objs  = []


def cross_seats(x0, y0, x1, y1):
    """The classic four-seat cross around the room centre (rooms 4-6)."""
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    return [
        (cx - 2, cy,     "right"),
        (cx + 2, cy,     "left"),
        (cx,     cy - 2, "down"),
        (cx,     cy + 2, "up"),
    ]


def table_seats(x0, y0, x1, y1, count):
    """`count` chairs in two facing rows (a conference table), symmetric about
    the room centre so the auto-placed centre table stays centred. Seats sit two
    tiles above/below the centre row with a two-tile horizontal pitch; the seat
    ordering is top row left→right, then bottom row — so seats 0 and 1 are always
    reachable side-by-side chairs. Sizes the hostel rooms to their capacities."""
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    top_n = (count + 1) // 2
    bot_n = count // 2
    seats = []
    for i in range(top_n):
        tx = cx + 2 * i - (top_n - 1)
        seats.append((tx, cy - 2, "down"))
    for i in range(bot_n):
        tx = cx + 2 * i - (bot_n - 1)
        seats.append((tx, cy + 2, "up"))
    return seats


def make_room(room_id, x0, y0, x1, y1, door_x, seats, door_wall="south"):
    wall_rect(x0, y0, x1, y1)
    door_y = y1 if door_wall == "south" else y0
    door_gap(door_x, door_y, width=2)
    # solid indoor floor (rooms 4-6 inherit the HQ slab; free-standing hostel
    # rooms need their own) plus a centre rug under the meeting table.
    fill(ground, x0 + 1, y0 + 1, x1 - 1, y1 - 1, FLOOR)
    rcx, rcy = (x0 + x1) // 2, (y0 + y1) // 2
    fill(ground, rcx - 2, rcy - 1, rcx + 2, rcy + 1, FLOOR_MOSS)

    door_zones.append({
        "id": 10000 + room_id, "name": f"room_{room_id}_door",
        "x": door_x * TS, "y": door_y * TS,
        "width": 2 * TS, "height": TS,
        "rotation": 0, "type": "", "visible": True,
        "properties": [{"name": "roomId", "type": "string", "value": str(room_id)}],
    })
    room_bounds.append({
        "id": 11000 + room_id, "name": f"room_{room_id}_bounds",
        "x": (x0 + 1) * TS, "y": (y0 + 1) * TS,
        "width": (x1 - x0 - 1) * TS, "height": (y1 - y0 - 1) * TS,
        "rotation": 0, "type": "", "visible": True,
        "properties": [{"name": "roomId", "type": "string", "value": str(room_id)}],
    })
    for seat_id, (tx, ty, facing) in enumerate(seats):
        seats_objs.append({
            "id": 12000 + room_id * 10 + seat_id, "name": f"room_{room_id}_seat_{seat_id}",
            "x": tx * TS, "y": ty * TS,
            "width": TS, "height": TS,
            "rotation": 0, "type": "", "visible": True,
            "properties": [
                {"name": "roomId",  "type": "string", "value": str(room_id)},
                {"name": "seatId",  "type": "int",    "value": seat_id},
                {"name": "facing",  "type": "string", "value": facing},
            ],
        })


# HQ meeting rooms D/E/F (IDs 4-6): four-seat rooms inside the HQ shell.
make_room(4, x0=31, y0=2, x1=43, y1=11, door_x=36, seats=cross_seats(31, 2, 43, 11))
make_room(5, x0=44, y0=2, x1=57, y1=11, door_x=49, seats=cross_seats(44, 2, 57, 11))
make_room(6, x0=58, y0=2, x1=71, y1=11, door_x=63, seats=cross_seats(58, 2, 71, 11))

# ── HOSTEL WING (S) ──────────────────────────────────────────────────────────
# A residential building south of the plaza holding the three private rooms
# 1-3 (capacities 5/8/12). The three rooms share side walls into one structure
# with a common north facade at y=100; their north-wall doors open onto a stone
# forecourt reached down the central path. roomBounds (roomId 1/2/3) alone give
# each interior its private audio zone.
HOSTEL_FACADE_Y = 100
# forecourt north of the facade + the path linking it to the plaza artery
fill(ground, 8, 93, 54, 99, STONE)
fill(ground, 34, 46, 35, 92, STONE)
make_room(1, x0=40, y0=100, x1=52, y1=109, door_x=45,
          seats=table_seats(40, 100, 52, 109, 5),  door_wall="north")
make_room(2, x0=26, y0=100, x1=40, y1=109, door_x=32,
          seats=table_seats(26, 100, 40, 109, 8),  door_wall="north")
make_room(3, x0=10, y0=100, x1=26, y1=110, door_x=17,
          seats=table_seats(10, 100, 26, 110, 12), door_wall="north")

# ── ARCADE ROOM (S, east of the hostel) ──────────────────────────────────────
# A dedicated, enclosed games hall well south of the plaza and FAR from the
# auditorium (NE). It is a PUBLIC walk-in zone, not a meeting room: it has an
# open north doorway (a wall gap, NO doorZone → no lock/knock/animated door) and
# NO seats (so it never arms the all-seated meeting trigger). It DOES get a
# `roomBounds` rect (roomId "arcade") purely for its own audio zone — voices stay
# inside the hall — and a minimap footprint. The three cabinets line the north
# wall; players approach each from the open floor to its south (same zone shape
# as before). A stone spur off the full-height x=79-80 artery paves the walk from
# spawn straight south to the door.
AX0, AY0, AX1, AY1 = 67, 94, 87, 108
ARCADE_DOOR_X = 79   # aligns with the x=79-80 stone artery running down from spawn
wall_rect(AX0, AY0, AX1, AY1)
door_gap(ARCADE_DOOR_X, AY0, width=2)
# Interior: tan-plank hall with an olive-checker runner down the cabinet row and
# a centre rug — cohesive with the existing indoor palette (no new tiles).
fill(ground, AX0 + 1, AY0 + 1, AX1 - 1, AY1 - 1, FLOOR_ACC)
fill(ground, AX0 + 2, AY0 + 2, AX1 - 2, AY0 + 2, FLOOR_MOSS)          # cabinet-row runner
fill(ground, (AX0 + AX1) // 2 - 3, (AY0 + AY1) // 2,
     (AX0 + AX1) // 2 + 3, (AY0 + AY1) // 2 + 1, FLOOR_MOSS)          # centre rug
# Pave the approach spur from the coworking deck down to the door (the artery is
# already stone above y=88; this just guarantees the two door tiles read paved).
fill(ground, ARCADE_DOOR_X, AY0, ARCADE_DOOR_X + 1, AY0, STONE)
room_bounds.append({
    "id": 11099, "name": "room_arcade_bounds",
    "x": (AX0 + 1) * TS, "y": (AY0 + 1) * TS,
    "width": (AX1 - AX0 - 1) * TS, "height": (AY1 - AY0 - 1) * TS,
    "rotation": 0, "type": "", "visible": True,
    "properties": [{"name": "roomId", "type": "string", "value": "arcade"}],
})

# ── GROUND DETAIL PASSES (PRD 12 fix round 1: ground variety) ────────────────
GRASS_FAMILY = {GRASS, GRASS_T1, GRASS_T2, GRASS_T3, GRASS_T4, GRASS_SPR1, GRASS_SPR2}


def is_grass(x, y):
    if x < 0 or y < 0 or x >= W or y >= H:
        return False
    return ground[idx(x, y)] in GRASS_FAMILY


# 1) Grass variety: deterministic scatter of tuft/sprout variants over base grass.
for y in range(H):
    for x in range(W):
        if ground[idx(x, y)] != GRASS:
            continue
        r = rng.random()
        if r < 0.05:
            ground[idx(x, y)] = GRASS_T1
        elif r < 0.10:
            ground[idx(x, y)] = GRASS_T2
        elif r < 0.15:
            ground[idx(x, y)] = GRASS_T3
        elif r < 0.18:
            ground[idx(x, y)] = GRASS_T4
        elif r < 0.20:
            ground[idx(x, y)] = GRASS_SPR1 if r < 0.19 else GRASS_SPR2

# 2) Grass clearings set into the plaza stone (2×2 inverse patches) — breaks
#    up the large stone expanse. Kept off the arteries and the spawn area.
for cx, cy in [(20, 30), (38, 33), (48, 55), (70, 52), (88, 32), (100, 56),
               (16, 50), (30, 57), (96, 48), (10, 68), (24, 74), (40, 70)]:
    if all(ground[idx(cx + dx, cy + dy)] == STONE for dx in (0, 1) for dy in (0, 1)):
        ground[idx(cx, cy)] = CLR_NW
        ground[idx(cx + 1, cy)] = CLR_NE
        ground[idx(cx, cy + 1)] = CLR_SW
        ground[idx(cx + 1, cy + 1)] = CLR_SE

# 3) Stone edge trims: every stone cell bordering grass takes the matching
#    edge/corner tile (grass side baked into the trim). Inner corners fall
#    back to plain fill — the tileset has no inner-corner tiles.
edge_pick = []
for y in range(H):
    for x in range(W):
        if ground[idx(x, y)] != STONE:
            continue
        n, s = is_grass(x, y - 1), is_grass(x, y + 1)
        wg, e = is_grass(x - 1, y), is_grass(x + 1, y)
        t = None
        if n and wg:
            t = ST_NW
        elif n and e:
            t = ST_NE
        elif s and wg:
            t = ST_SW
        elif s and e:
            t = ST_SE
        elif n:
            t = ST_N
        elif s:
            t = ST_S
        elif wg:
            t = ST_W
        elif e:
            t = ST_E
        if t is not None:
            edge_pick.append((x, y, t))
for x, y, t in edge_pick:
    ground[idx(x, y)] = t

# 4) Flowers on the ground_decor overlay: park + cafe margins, denser along
#    path edges so walkways read tended.
FLOWERS = [FLOWER_RED, FLOWER_BLUE, FLOWER_PALE, FLOWER_SMALL]
for y in range(1, H - 1):
    for x in range(1, W - 1):
        if not is_grass(x, y):
            continue
        near_stone = any(
            ground[idx(x + dx, y + dy)] == STONE or ground[idx(x + dx, y + dy)] in
            (ST_NW, ST_N, ST_NE, ST_W, ST_E, ST_SW, ST_S, ST_SE)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
        )
        in_park = x <= 28 and y <= 55
        in_cafe = x <= 55 and y >= 62
        p = 0.10 if near_stone else (0.05 if (in_park or in_cafe) else 0.015)
        if rng.random() < p:
            ground_decor[idx(x, y)] = rng.choice(FLOWERS)

# 5) Trees (park + cafe east margin): canopy rows render over the player
#    (decor_above), the trunk row is solid (walls layer → collision), and the
#    ground shadow row sits under the player (ground_decor). Positions avoid
#    every E2E waypoint corridor (all inside HQ/plaza) and the path arteries.
TREES_BIG = [(3, 2), (12, 3), (20, 2), (6, 12), (16, 11), (23, 13),
             (3, 20), (13, 20), (22, 21), (8, 27), (18, 27),
             (3, 36), (12, 35), (21, 36), (6, 47), (15, 47), (23, 47),
             (49, 63), (49, 71)]
TREES_SMALL = [(9, 6), (25, 7), (11, 15), (2, 28), (25, 30), (9, 39),
               (19, 39), (2, 51), (19, 51), (26, 51)]
tree_cells = set()


def plant_tree(block, tx, ty):
    rows = len(block)
    for ry, row in enumerate(block):
        for rx, gid in enumerate(row):
            x, y = tx + rx, ty + ry
            tree_cells.add((x, y))
            if ry < rows - 2:
                decor_above[idx(x, y)] = gid      # canopy
            elif ry == rows - 2:
                walls_data[idx(x, y)] = gid        # trunk (solid)
            else:
                ground_decor[idx(x, y)] = gid      # shadow


for tx, ty in TREES_BIG:
    plant_tree(TREE_BIG, tx, ty)
for tx, ty in TREES_SMALL:
    plant_tree(TREE_SMALL, tx, ty)

# ── INTERACTABLES ─────────────────────────────────────────────────────────────
# Each object is a 32×32 px zone (2×2 tiles) at the tile's top-left corner.
# Properties: interactType (portal|info|whiteboard|arcade), label, and type-
# specific payload (targetX/targetY for portal; content for info/whiteboard).
interactables_objs = [
    {
        "id": 40001, "name": "portal_east",
        "x": 27 * TS, "y": 43 * TS, "width": 2 * TS, "height": 2 * TS,
        "rotation": 0, "type": "", "visible": True,
        "properties": [
            {"name": "interactType", "type": "string", "value": "portal"},
            {"name": "label",        "type": "string", "value": "Shortcut → East"},
            {"name": "targetX",      "type": "int",    "value": 80 * TS},
            {"name": "targetY",      "type": "int",    "value": 43 * TS},
        ],
    },
    {
        "id": 40002, "name": "info_board_plaza",
        "x": 18 * TS, "y": 38 * TS, "width": 2 * TS, "height": 2 * TS,
        "rotation": 0, "type": "", "visible": True,
        "properties": [
            {"name": "interactType", "type": "string", "value": "info"},
            {"name": "label",        "type": "string", "value": "Campus Map"},
            {"name": "content",      "type": "string",
             "value": (
                 "Welcome to Hyprverse Campus!\n\n"
                 "  HQ (north)       — meeting rooms D, E, F\n"
                 "  Auditorium (NE)  — presentations & broadcast\n"
                 "  Plaza (center)   — open collaboration\n"
                 "  Cafe (SW)        — social lounge\n"
                 "  Coworking (SE)   — open desk pods\n"
                 "  Hostel (south)   — private rooms 1, 2, 3\n"
                 "  Arcade (south)   — Snake, Flappy, 2048\n\n"
                 "Tip: head south past coworking for\n"
                 "the arcade — or portal across the park!"
             )},
        ],
    },
    {
        "id": 40003, "name": "whiteboard_hq",
        "x": 55 * TS, "y": 19 * TS, "width": 2 * TS, "height": 2 * TS,
        "rotation": 0, "type": "", "visible": True,
        "properties": [
            {"name": "interactType", "type": "string", "value": "whiteboard"},
            {"name": "label",        "type": "string", "value": "Today's Agenda"},
            {"name": "content",      "type": "string",
             "value": (
                 "Today's Agenda\n"
                 "──────────────\n"
                 "10:00  Sprint planning  (Room D)\n"
                 "12:00  Lunch break\n"
                 "14:00  Campus tour\n"
                 "16:00  All-hands meeting\n\n"
                 "Private rooms: knock and the admin lets you in"
             )},
        ],
    },
    # ── Arcade cabinets (PRD 16) — now inside the dedicated Arcade Room (north
    # wall, rows 96-99). Each zone covers its cabinet tile plus the three open
    # tiles below it: the 32px solid cabinet body clears by row 98, so rows 98-99
    # give a collision-free approach strip that is still inside the findNear rect.
    # `game` selects the module. Snake/Flappy sit west of the north doorway
    # (x=79-80); 2048 sits east of it.
    {
        "id": 40010, "name": "arcade_snake",
        "x": 71 * TS, "y": 96 * TS, "width": 2 * TS, "height": 4 * TS,
        "rotation": 0, "type": "", "visible": True,
        "properties": [
            {"name": "interactType", "type": "string", "value": "arcade"},
            {"name": "label",        "type": "string", "value": "Snake"},
            {"name": "game",         "type": "string", "value": "snake"},
        ],
    },
    {
        "id": 40011, "name": "arcade_flappy",
        "x": 76 * TS, "y": 96 * TS, "width": 2 * TS, "height": 4 * TS,
        "rotation": 0, "type": "", "visible": True,
        "properties": [
            {"name": "interactType", "type": "string", "value": "arcade"},
            {"name": "label",        "type": "string", "value": "Flappy"},
            {"name": "game",         "type": "string", "value": "flappy"},
        ],
    },
    {
        "id": 40012, "name": "arcade_2048",
        "x": 84 * TS, "y": 96 * TS, "width": 2 * TS, "height": 4 * TS,
        "rotation": 0, "type": "", "visible": True,
        "properties": [
            {"name": "interactType", "type": "string", "value": "arcade"},
            {"name": "label",        "type": "string", "value": "2048"},
            {"name": "game",         "type": "string", "value": "2048"},
        ],
    },
]

# ── STAGE (Auditorium) ───────────────────────────────────────────────────
# stage_zone   — audience area (tiles 82-117, y=16-43)
# presenter_zone — podium area (tiles 90-110, y=2-15)
# screen        — point marking the broadcast screen (tile 99, 5)
stage_objs = [
    {
        "id": 50001, "name": "stage_zone",
        "x": 82 * TS, "y": 16 * TS,
        "width": 36 * TS, "height": 28 * TS,
        "rotation": 0, "type": "", "visible": True,
        "properties": [{"name": "zoneType", "type": "string", "value": "stage"}],
    },
    {
        "id": 50002, "name": "presenter_zone",
        "x": 90 * TS, "y": 2 * TS,
        "width": 21 * TS, "height": 14 * TS,
        "rotation": 0, "type": "", "visible": True,
        "properties": [{"name": "zoneType", "type": "string", "value": "presenter"}],
    },
    {
        "id": 50003, "name": "screen",
        "x": 99 * TS, "y": 5 * TS,
        "width": 0, "height": 0,
        "point": True, "rotation": 0, "type": "", "visible": True,
        "properties": [],
    },
]

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


# Park — the tile trees above carry the canopy now; sprinkle swaying shrubs
# between them (skipping any spot a tree footprint occupies).
for tx, ty in [(8, 8), (16, 8), (24, 9), (11, 18), (22, 18),
               (5, 23), (15, 23), (20, 28), (25, 23),
               (8, 38), (18, 38), (25, 38), (10, 47), (24, 47)]:
    if (tx, ty) not in tree_cells:
        furn("f_plant_big", tx, ty, True)
for tx, ty in [(6,6),(14,11),(21,6),(9,20),(18,24),
               (6,30),(14,35),(22,30),(7,40),(20,42),
               (5,50),(12,52),(19,50)]:
    if (tx, ty) not in tree_cells:
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

# Hostel forecourt — planters framing the residential facade (kept clear of the
# door columns 17/32/45 and the central approach path at x=34-35).
furn("f_plant_big",   11, 94, True)
furn("f_plant_big",   51, 94, True)
furn("f_plant_small", 21, 95, False)
furn("f_plant_small", 43, 95, False)
furn("f_sofa_small",  8, 97, True)

# Arcade Room (south) — solid cabinets lining the north wall; each pairs with an
# arcade interactable zone at the same tile (see interactables_objs). Plus a
# little themed dressing so the hall doesn't read empty.
furn("f_arcade_snake",  71, 96, True)
furn("f_arcade_flappy", 76, 96, True)
furn("f_arcade_2048",   84, 96, True)
furn("f_vending",       68, 96, True)   # snack machine by the entrance wall
furn("f_plant_big",     68, 107, True)  # corner greenery
furn("f_plant_big",     86, 107, True)
furn("f_sofa",          80, 106, True)  # a lounge bench facing the cabinets
furn("f_sofa_small",    83, 106, True)

# ── Board-game tables (PRD 11 phase 2) ────────────────────────────────────
# Two two-seat tables in the SW plaza. tableId + game must match the shared
# BOARD_TABLES registry; each seat opens a server-authoritative match. The board
# itself renders in a React HUD panel — the map only carries the solid table
# sprite and the two opposite seats.
board_seats = []


def board_table(table_id, game, label, cx, ty):
    furn("f_table_small", cx, ty, True)  # solid table at the centre tile
    for seat, (tx, facing) in enumerate([(cx - 2, "right"), (cx + 2, "left")]):
        board_seats.append({
            "id": 41000 + len(board_seats),
            "name": f"{table_id}_seat_{seat}",
            "x": tx * TS, "y": ty * TS,
            "width": TS, "height": TS,
            "rotation": 0, "type": "", "visible": True,
            "properties": [
                {"name": "tableId", "type": "string", "value": table_id},
                {"name": "seat",    "type": "int",    "value": seat},
                {"name": "game",    "type": "string", "value": game},
                {"name": "label",   "type": "string", "value": label},
                {"name": "facing",  "type": "string", "value": facing},
            ],
        })


board_table("ttt-1", "tictactoe", "Tic-Tac-Toe", 37, 51)
board_table("c4-1",  "connect4",  "Connect 4",   43, 51)

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
    "nextlayerid": 14,
    "nextobjectid": 50004,
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
        {"id": 12, "name": "ground_decor", "type": "tilelayer", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "width": W, "height": H, "data": ground_decor},
        {"id": 2,  "name": "walls",       "type": "tilelayer",  "visible": True,
         "opacity": 1, "x": 0, "y": 0, "width": W, "height": H, "data": walls_data},
        {"id": 9,  "name": "decor_above", "type": "tilelayer",  "visible": True,
         "opacity": 1, "x": 0, "y": 0, "width": W, "height": H, "data": decor_above},
        {"id": 3,  "name": "doorZones",   "type": "objectgroup", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "draworder": "topdown", "objects": door_zones},
        {"id": 4,  "name": "seats",       "type": "objectgroup", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "draworder": "topdown", "objects": seats_objs},
        {"id": 13, "name": "board_seats", "type": "objectgroup", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "draworder": "topdown", "objects": board_seats},
        {"id": 7,  "name": "roomBounds",  "type": "objectgroup", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "draworder": "topdown", "objects": room_bounds},
        {"id": 6,  "name": "furniture",   "type": "objectgroup", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "draworder": "topdown", "objects": furniture},
        {"id": 10, "name": "interactables", "type": "objectgroup", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "draworder": "topdown", "objects": interactables_objs},
        {"id": 11, "name": "stage",        "type": "objectgroup", "visible": True,
         "opacity": 1, "x": 0, "y": 0, "draworder": "topdown", "objects": stage_objs},
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
print(f"  rooms: {len(door_zones)} doorZones, {len(room_bounds)} roomBounds, {len(seats_objs)} seats")
print(f"  interactables: {len(interactables_objs)} objects")
print(f"  stage: {len(stage_objs)} objects (stage_zone + presenter_zone + screen)")
print(f"  spawn @ tile ({SPAWN_TX},{SPAWN_TY}) = px ({SPAWN_TX*TS},{SPAWN_TY*TS})")
