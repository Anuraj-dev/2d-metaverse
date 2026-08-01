"""Hostel rooms 1 and 2 — the south-wing private meeting rooms.

Both rooms exist for one activity: players walk in, take a seat at the long
table and hold a meeting. The table and the seat rows are the room; everything
else is a thin dressing of the walls, so the floor a player crosses on the way
in stays empty. Rooms 1 and 2 are siblings, not clones — room 2 is the softer
"discussion room" (a world map, a pinned agenda, corner greenery), room 1 the
"briefing room" (whiteboard at the head of the table, a reference shelf).

Geometry (frozen):
  Room 1  interior x=41..51, y=101..108   door gap x=45-46 on north wall (y=100)
          seats     y=102 at x=44,46,48;  y=106 at x=45,47  (5)
  Room 2  interior x=27..39, y=101..108   door gap x=32-33 on north wall (y=100)
          seats     y=102 and y=106 at x=30,32,34,36        (8)

Walkability (player body 18px, tiles 16px → lanes ≥2 tiles). WorldScene gives a
solid sprite a 0.8w × 0.55h body anchored to its bottom edge, so a 32px solid
claims its own column ±1 and the row below its anchor:
  · rows 103 and 107 are the approach aisles for the two seat rows and carry no
    solid body at all — the table run (row 104) is the only thing between them;
  · the end bays (room 1 cols 41-43 / 49-51, room 2 cols 27-29 / 37-39) are the
    only way around the table, so solids there sit on the north row (101) or the
    south row (108) and never in the middle;
  · the door columns stay clear on the first interior row, so entry is never
    blocked;
  · wall art is non-solid and hangs on the actual north wall row 100, clear of
    the taller LimeZu chair visuals on row 102.
"""

R1_X0, R1_Y0, R1_X1, R1_Y1 = 41, 101, 51, 108
R2_X0, R2_Y0, R2_X1, R2_Y1 = 27, 101, 39, 108


def decorate(ctx, phase: str) -> None:
    if phase == "floor":
        # Cream wall-to-wall with a single accent: a slate band between the two
        # seat rows that reads as a rug under the meeting table and tells a
        # player at the door where the room's business happens.
        ctx.fill_pattern(R1_X0, R1_Y0, R1_X1, R1_Y1, ctx.FLOOR_CREAM)
        ctx.fill_pattern(44, 103, 48, 105, ctx.FLOOR_SLATE)
        ctx.fill_pattern(45, 100, 46, 100, ctx.FLOOR_CREAM)

        ctx.fill_pattern(R2_X0, R2_Y0, R2_X1, R2_Y1, ctx.FLOOR_CREAM)
        ctx.fill_pattern(30, 103, 36, 105, ctx.FLOOR_SLATE)
        ctx.fill_pattern(32, 100, 33, 100, ctx.FLOOR_CREAM)

    elif phase == "furniture":
        # ── Room 2 — discussion room ────────────────────────────────────────
        # North wall: a world map over the table and a pinned agenda board at
        # the east end — the room's only two hung pieces, both on stretches of
        # wall no solid stands in front of.
        ctx.furn("f_lz_worldmap", 30, 100, False)
        ctx.furn("f_lz_pinboard", 37, 100, False)
        # South-west corner greenery, clear of the col-29/30 walking lane.
        ctx.furn("f_lz_palm", 27, 108, True)
        # The meeting table: 1-tile modules butted into one continuous run
        # spanning every seat column, papers and a cup left on it.
        ctx.furn("f_lz_table", 30, 104, True)
        ctx.furn("f_lz_table_books", 31, 104, True)
        ctx.furn("f_lz_table", 32, 104, True)
        ctx.furn("f_lz_table_cup", 33, 104, True)
        ctx.furn("f_lz_table", 34, 104, True)
        ctx.furn("f_lz_table_books", 35, 104, True)
        ctx.furn("f_lz_table", 36, 104, True)

        # ── Room 1 — briefing room ──────────────────────────────────────────
        # West end bay: the whiteboard the table faces, with the reference
        # shelf below it on the south wall.
        ctx.furn("f_lz_whiteboard", 42, 100, False)
        ctx.furn("f_lz_bookshelf", 42, 108, True)
        # East end bay: one floor plant anchors the south wall without adding
        # redundant waiting furniture to a room already built around seating.
        ctx.furn("f_lz_plant", 50, 108, True)
        # The meeting table, shorter run than room 2's.
        ctx.furn("f_lz_table_books", 44, 104, True)
        ctx.furn("f_lz_table", 45, 104, True)
        ctx.furn("f_lz_table_cup", 46, 104, True)
        ctx.furn("f_lz_table", 47, 104, True)
        ctx.furn("f_lz_table_books", 48, 104, True)

    else:
        raise ValueError(f"hostel_rooms12: unknown phase {phase!r}")
