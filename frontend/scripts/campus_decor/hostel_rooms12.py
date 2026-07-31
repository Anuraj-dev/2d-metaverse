"""Hostel rooms 1 and 2 — LimeZu art pass (south wing study/meeting rooms).

Sibling rooms to hostel_room3: same student-common-room language, different
layouts so they do not read as clones. No beds — soft seating, shelves, lamps,
plants, a kitchenette corner, wall art.

Geometry (frozen):
  Room 1  interior x=41..51, y=101..108   door gap x=45-46 on north wall (y=100)
          seats     y=102 at x=44,46,48;  y=106 at x=45,47  (5)
  Room 2  interior x=27..39, y=101..108   door gap x=32-33 on north wall (y=100)
          seats     y=102 and y=106 at x=30,32,34,36        (8)

Walkability (player body 18px, tiles 16px → lanes ≥2 tiles):
  · rows 103 and 105 stay free of solid bodies — approach aisles for the two
    seat rows (table sits on row 104 between them);
  · west and east end bays stay connected around the table run;
  · door columns stay clear on the first interior row (room 1: 45-46, room 2:
    32-33 at y=101) so entry is not blocked;
  · north-wall solids at y=101 spill their body into y=102 (where seats sit),
    so they only land in end bays that share no seat column.
"""

R1_X0, R1_Y0, R1_X1, R1_Y1 = 41, 101, 51, 108
R2_X0, R2_Y0, R2_X1, R2_Y1 = 27, 101, 39, 108


def decorate(ctx, phase: str) -> None:
    if phase == "floor":
        # Cream wall-to-wall. Accents stay small and low-contrast: a short
        # slate strip under each table (quieter against the brick than room 3's
        # saturated parquet), plus teal kitchenette bays back-to-back on the
        # shared wall so lounges face the outer walls.
        ctx.fill_pattern(R1_X0, R1_Y0, R1_X1, R1_Y1, ctx.FLOOR_CREAM)
        ctx.fill_pattern(44, 104, 48, 104, ctx.FLOOR_SLATE)
        ctx.fill_pattern(41, 101, 43, 102, ctx.FLOOR_TEAL)
        ctx.fill_pattern(45, 100, 46, 100, ctx.FLOOR_CREAM)

        ctx.fill_pattern(R2_X0, R2_Y0, R2_X1, R2_Y1, ctx.FLOOR_CREAM)
        ctx.fill_pattern(30, 104, 36, 104, ctx.FLOOR_SLATE)
        ctx.fill_pattern(37, 101, 39, 102, ctx.FLOOR_TEAL)
        ctx.fill_pattern(32, 100, 33, 100, ctx.FLOOR_CREAM)

    elif phase == "furniture":
        # Wall-hung art first at equal depth so sofas/counters draw over it.

        # ── Room 2 — lounge west (outer), kitchenette east (shared wall) ────
        # Lounge bay cols 27-29 (seat cols start at 30). Sofa at 27 keeps its
        # 48px right edge clear of seat 30.
        ctx.furn("f_lz_board", 27, 101, False)
        ctx.furn("f_lz_window", 29, 101, False)
        ctx.furn("f_lz_sofa_tan", 27, 101, True)
        ctx.furn("f_lz_side_table", 29, 103, False)
        # Mid-north wall art on free cols (non-solid only — single-tile gaps).
        ctx.furn("f_lz_worldmap", 31, 101, False)
        ctx.furn("f_lz_pinboard", 34, 101, False)
        # Kitchenette bay cols 37-39. 32px jar-shelf would claim seat col 36
        # (anchor 37) or shared-wall col 40 against room1's counter (anchor 39),
        # so it is non-solid decoration; the 16px fridge alone blocks the bay.
        ctx.furn("f_lz_poster_grid", 37, 101, False)
        ctx.furn("f_lz_shelf_jars", 37, 101, False)
        ctx.furn("f_lz_fridge", 39, 101, True)
        # Study table between the seat rows.
        ctx.furn("f_lz_table_books", 30, 104, True)
        ctx.furn("f_lz_table", 31, 104, True)
        ctx.furn("f_lz_table_cup", 32, 104, True)
        ctx.furn("f_lz_table", 33, 104, True)
        ctx.furn("f_lz_desk_hat", 34, 104, True)
        ctx.furn("f_lz_table", 35, 104, True)
        ctx.furn("f_lz_table_books", 36, 104, True)
        # Walkable book stack at the free west table end.
        ctx.furn("f_lz_books", 28, 104, False)
        # South wall — study-nook mix. 32px solids claim ±1 col and spill into
        # y=109, so they must avoid artery cols 29-30 (stone on the wall row)
        # and not share a body tile. Palm west of artery; bookshelf/sideboard
        # east of it with a one-tile plant_small (non-solid) in the gap.
        ctx.furn("f_lz_palm", 27, 108, True)
        ctx.furn("f_lz_floor_lamp_blue", 31, 108, True)
        ctx.furn("f_lz_bookshelf", 33, 108, True)
        ctx.furn("f_lz_plant_small", 35, 108, False)
        ctx.furn("f_lz_sideboard", 36, 108, True)
        ctx.furn("f_lz_plant", 39, 108, True)

        # ── Room 1 — kitchenette west (shared wall), lounge east (outer) ────
        # Kitchenette bay cols 41-43. Counter (not jar-shelf) so this room
        # reads different from room 2; 48px at 41 stays west of seat col 44.
        # Fridge one tile east of the counter run, same spacing as room 3.
        ctx.furn("f_lz_counter", 41, 101, True)
        ctx.furn("f_lz_fridge", 43, 101, True)
        # Visible wall art between door and lounge.
        ctx.furn("f_lz_painting2", 47, 101, False)
        # Lounge bay cols 49-51. Loveseat at 50 clears seat col 48.
        ctx.furn("f_lz_painting", 49, 101, False)
        ctx.furn("f_lz_window_blinds", 51, 101, False)
        ctx.furn("f_lz_sofa_2seat", 50, 101, True)
        ctx.furn("f_lz_side_table", 49, 103, False)
        # Study table between the seat rows (shorter run than room 2).
        ctx.furn("f_lz_table", 44, 104, True)
        ctx.furn("f_lz_table_books", 45, 104, True)
        ctx.furn("f_lz_table", 46, 104, True)
        ctx.furn("f_lz_table_cup", 47, 104, True)
        ctx.furn("f_lz_table", 48, 104, True)
        # Walkable book stack at the free east table end.
        ctx.furn("f_lz_books2", 50, 104, False)
        # South wall — lamp, plants, shelf, reading chair, globe. Plant is 32px
        # (±1 col) so it sits on 49 with the 16px globe on 51 and the armchair
        # nudged to 47 to clear the plant's west edge.
        ctx.furn("f_lz_floor_lamp", 41, 108, True)
        ctx.furn("f_lz_plant_small", 43, 108, True)
        ctx.furn("f_lz_shelf_white", 45, 108, True)
        ctx.furn("f_lz_armchair", 47, 108, True)
        ctx.furn("f_lz_plant", 49, 108, True)
        ctx.furn("f_lz_globe", 51, 108, True)

    else:
        raise ValueError(f"hostel_rooms12: unknown phase {phase!r}")
