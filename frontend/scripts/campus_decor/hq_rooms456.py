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

Each room is a table with chairs around it and one clear identity — strategy,
lounge, library — so a player can tell them apart at a glance. The rooms are
small and their whole job is to hold a seated conversation, so the floor stays
open: everything that survives is either hung on a wall or part of one named
cluster, and the walk from the south door to the seats is never in the way of a
prop.

Walkability (player body 18px, tiles 16px → lanes ≥2 tiles):
  · the centre table is a single module at the room centre and the E/W seats
    are two tiles out, so the ring around the table stays walkable;
  · the door columns stay clear of solid bodies on rows 9-11 — that is the
    approach aisle from the hall;
  · solids on the south wall sit at row 10 (body → rows 10-11) and solids on
    the north wall at rows 3-4, hugging the wall line;
  · wall-hung art (non-solid, no collision at all) sits on row 3 so its 2-tile
    height straddles the north wall line and reads as mounted, not dropped.
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
        # an office window beside it. Cluster "planning corner": the filing bank
        # in the south-west, clear of the door columns.
        ctx.furn("f_lz_window_blinds", 33, 3, False)
        ctx.furn("f_lz_board", 37, 3, False)
        ctx.furn("f_lz_table_books", 37, 6, True)  # meeting table, papers on top
        ctx.furn("f_lz_filing", 33, 10, True)
        ctx.furn("f_lz_plant_small", 42, 10, True)  # south-east corner green

        # ── Room 5 — the lounge ─────────────────────────────────────────
        # Softer room for informal meetings: a draped window over the head seat
        # and one framed piece dress the north wall, and cluster "lounge corner"
        # (two-seat couch, round side table, potted plant) fills the south-east
        # corner for the people who would rather not take a chair. Nothing hangs
        # on the side walls — a side wall is one tile of orange band in this
        # projection, so art mounted there reads as floating over the floor.
        ctx.furn("f_lz_painting", 46, 3, False)
        ctx.furn("f_lz_window_curtains", 50, 3, False)
        ctx.furn("f_lz_table", 50, 6, True)  # meeting table
        ctx.furn("f_lz_plant_small", 53, 10, True)
        ctx.furn("f_lz_armchair", 55, 10, True)
        ctx.furn("f_lz_side_table", 56, 9, False)

        # ── Room 6 — the library ────────────────────────────────────────
        # Quiet focus room. Cluster "reference wall": two book stacks flanking a
        # world map on the north wall, with the desk globe tucked against the
        # east wall beside the white shelf. Cluster "reading nook": floor lamp +
        # armchair in the south-west corner, well west of the door columns.
        ctx.furn("f_lz_bookshelf", 60, 3, True)
        ctx.furn("f_lz_worldmap", 64, 3, False)
        ctx.furn("f_lz_shelf_white", 68, 3, True)
        ctx.furn("f_lz_globe", 70, 4, True)
        ctx.furn("f_lz_table_study", 64, 6, True)  # study desk doubles as the table
        ctx.furn("f_lz_floor_lamp", 59, 10, True)
        ctx.furn("f_lz_armchair", 60, 10, True)

    else:
        raise ValueError(f"hq_rooms456: unknown phase {phase!r}")
