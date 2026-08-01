"""HQ meeting rooms 4-6 — LimeZu art pass.

Three private meeting rooms off the HQ hall. Geometry is frozen (the seats drive
the meeting FSM, the walls are the HQ shell); this module only repaints the
floors and dresses the walls around the existing four-seat cross + door.

  Room 4  interior x=32..42, y=3..10   door gap y=11, x=36..37
          seats (35,6) (39,6) (37,4) (37,8)   centre (37,6)
  Room 5  interior x=45..56, y=3..10   door gap y=11, x=49..50
          seats (48,6) (52,6) (50,4) (50,8)   centre (50,6)
  Room 6  interior x=59..70, y=3..10   door gap y=11, x=63..64
          seats (62,6) (66,6) (64,4) (64,8)   centre (64,6)

Each room is a table with four sit-enabled chairs and restrained wall identity.
The annotated review explicitly removes the auxiliary corner furniture: no
reading chairs, side tables, filing piles, floor lamps, or decorative plants.

Walkability (player body 18px, tiles 16px → lanes ≥2 tiles):
  · the centre table is a single module at the room centre and the E/W seats
    are two tiles out, so the ring around the table stays walkable;
  · the door columns stay clear of solid bodies on rows 9-11 — that is the
    approach aisle from the hall;
  · solids on the south wall sit at row 10 (body → rows 10-11) and solids on
    the north wall at rows 3-4, hugging the wall line;
  · wall-hung art (non-solid, no collision at all) sits on the actual north
    wall row 2, above the taller LimeZu chair visuals on row 4.
"""


def decorate(ctx, phase: str) -> None:
    if phase == "floor":
        # Cream wall-to-wall in all three, plus a small accent rug under each
        # meeting table. The rug colour is the room's tell: cool slate for the
        # strategy room, teal for the lounge, warm parquet for the library.
        # ── Room 4 — strategy ───────────────────────────────────────────
        ctx.fill_pattern(32, 3, 42, 10, ctx.FLOOR_CREAM)
        ctx.fill_pattern(36, 5, 38, 7, ctx.FLOOR_SLATE)
        ctx.fill_pattern(36, 11, 37, 11, ctx.FLOOR_CREAM)  # door threshold

        # ── Room 5 — lounge ─────────────────────────────────────────────
        ctx.fill_pattern(45, 3, 56, 10, ctx.FLOOR_CREAM)
        ctx.fill_pattern(49, 5, 51, 7, ctx.FLOOR_TEAL)
        ctx.fill_pattern(49, 11, 50, 11, ctx.FLOOR_CREAM)

        # ── Room 6 — library ────────────────────────────────────────────
        ctx.fill_pattern(59, 3, 70, 10, ctx.FLOOR_CREAM)
        ctx.fill_pattern(63, 5, 65, 7, ctx.FLOOR_PARQUET)
        ctx.fill_pattern(63, 11, 64, 11, ctx.FLOOR_CREAM)

    elif phase == "furniture":
        # ── Room 4 — the strategy room ──────────────────────────────────
        # Cluster "presentation wall": the dark board hangs directly above the
        # north seat, so whoever takes that chair is the one at the board, with
        # an office window beside it.
        ctx.furn("f_lz_window_blinds", 33, 2, False)
        ctx.furn("f_lz_chalkboard", 37, 2, False)
        ctx.furn("f_lz_table_books", 37, 6, True)  # meeting table, papers on top

        # ── Room 5 — the lounge ─────────────────────────────────────────
        # Softer room for informal meetings: a draped window over the head seat
        # and one framed piece dress the north wall.
        # Nothing hangs
        # on the side walls — a side wall is one tile of orange band in this
        # projection, so art mounted there reads as floating over the floor.
        ctx.furn("f_lz_painting", 46, 2, False)
        ctx.furn("f_lz_window_curtains", 50, 2, False)
        ctx.furn("f_lz_table", 50, 6, True)  # meeting table

        # ── Room 6 — the library ────────────────────────────────────────
        # Quiet focus room. Cluster "reference wall": two book stacks with the
        # desk globe tucked against the east wall beside the white shelf.
        # The room identity stays on the north reference wall; the south half
        # is reserved for the door approach and gameplay seats.
        ctx.furn("f_lz_bookshelf", 60, 3, True)
        ctx.furn("f_lz_shelf_white", 68, 3, True)
        ctx.furn("f_lz_globe", 70, 4, True)
        ctx.furn("f_lz_table_study", 64, 6, True)  # study desk doubles as the table

    else:
        raise ValueError(f"hq_rooms456: unknown phase {phase!r}")
