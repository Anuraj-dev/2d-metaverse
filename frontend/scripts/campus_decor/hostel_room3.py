"""Hostel room 3 — LimeZu art pass.

Derived from the former "ROOM 3 ART PASS" / "ROOM 3 furnishing" blocks in
gen_campus.py. Geometry (seats, roomBounds, doorZone, walls) is frozen; this
module only repaints the floor and hangs furniture around it.

Geometry it has to live with (all frozen):
  interior  x=11..25, y=101..109      door gap  x=17-18 on the north wall
  seats     y=103 and y=107, at x=13,15,17,19,21,23 (12 of them)
Walkability rules the placement below obeys (WorldScene gives a solid sprite a
0.8w × 0.55h body anchored to its bottom edge, and the player body is 18×14, so
a lane must be ≥2 tiles wide):
  · rows 104 and 108 stay completely free of solid bodies — they are the aisles
    players approach the north and south seat rows from;
  · the table run (rows 105-106) leaves x=11-12 and x=24-25 clear, so both ends
    of the room stay connected around it;
  · column 18 stays clear at rows 101-103 — that is the walk down from the door.
"""

R3_X0, R3_Y0, R3_X1, R3_Y1 = 11, 101, 25, 109  # interior, inclusive


def decorate(ctx, phase: str) -> None:
    if phase == "floor":
        _paint_floor(ctx)
    elif phase == "furniture":
        _furnish(ctx)
    else:
        raise ValueError(f"hostel_room3: unknown phase {phase!r}")


def _paint_floor(ctx) -> None:
    # Floor: warm cream wall-to-wall, a parquet "rug" under the meeting table,
    # and a teal kitchenette bay in the north-east corner. This is what retires
    # FLOOR_MOSS here — the audit measured that "olive checkered carpet" as a
    # flat 2-colour block (125,104,18)/(129,108,23).
    ctx.fill_pattern(R3_X0, R3_Y0, R3_X1, R3_Y1, ctx.FLOOR_CREAM)
    ctx.fill_pattern(12, 103, 24, 107, ctx.FLOOR_PARQUET)  # rug under the table
    ctx.fill_pattern(21, 101, 25, 102, ctx.FLOOR_TEAL)  # kitchenette bay
    # The door gap itself sat on bare grass (make_room only floors the interior),
    # so the threshold read as a green hole in the facade. Pave it with the room
    # floor. MUST run before grass-variety RNG (a former-grass tile painted later
    # would consume an extra rng draw and desync the whole scatter).
    ctx.fill_pattern(17, 100, 18, 100, ctx.FLOOR_CREAM)


def _furnish(ctx) -> None:
    # A hostel common room / study lounge: the 12-seat table stays the focal
    # point and everything else dresses the walls around it. Sprites are cut
    # from the LimeZu interior sheet by scripts/gen_limezu_sprites.py (source
    # tile coords named there).
    # Placement notes (see the walkability rules in the module docstring):
    #   · wall-hung art sits on the actual north wall row 100;
    #   · solids all sit on row 101 (body → rows 101-102) or row 109 (body →
    #     rows 109-110), which keeps the seat-approach aisles at rows 104 and
    #     108 open.
    # North wall, west of the door — the reference wall. Wall-hung pieces sit
    # on the actual wall row; the shelf is wall-flush on the first floor row.
    ctx.furn("f_lz_board", 11, 100, False)
    ctx.furn("f_lz_window", 13, 100, False)
    ctx.furn("f_lz_bookshelf", 15, 101, True)
    # North wall, east of the door — the kitchenette.
    ctx.furn("f_lz_worldmap", 20, 100, False)
    ctx.furn("f_lz_counter", 22, 101, True)
    ctx.furn("f_lz_fridge", 24, 101, True)
    # The long study table between the two seat rows: 1-tile modules butt
    # together into one continuous run from the westmost to the eastmost seat
    # column.
    _R3_TABLE = ["f_lz_table", "f_lz_table_books", "f_lz_table", "f_lz_table_cup"]
    for _i, _tx in enumerate(range(13, 24)):
        ctx.furn(_R3_TABLE[_i % len(_R3_TABLE)], _tx, 105, True)
    # South wall — only the storage pieces the study room needs.
    ctx.furn("f_lz_sideboard", 16, 109, True)
    ctx.furn("f_lz_shelf_jars", 22, 109, True)
