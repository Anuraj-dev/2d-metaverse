"""HQ open-plan office hall — LimeZu art pass (north building).

Geometry it has to live with (all frozen):
  building interior   x=31..78, y=2..23
  meeting rooms 4/5/6 x=30..71, y=1..12  (hq_rooms456 owns their interiors)
  usable hall         x=31..78, y=12..23
  usable east strip   x=72..78, y=2..11   (east of room 6)
  room doors (y=11)   x=36-37, 49-50, 63-64
  south entrances     y=24, x=49-50 and x=58-59
  whiteboard zone     tiles 55..56, y=19..20  ("Today's Agenda" interactable)

Walkability (player body 18px > 1 tile — every lane ≥2 tiles):
  · y=12-13 free of solid bodies — corridor under the meeting-room doors
  · columns 49-50 and 58-59 clear y=12..23 — both south-door approaches
  · columns 36-37 and 63-64 clear y=12..23 — room 4/6 door columns
    (E2E walkTo is straight-line; whole swept corridor must be clear)
  · row 22 / y≈360 E-W band (cols 36..59) free of solid bodies —
    E2E forecourt waypoint at y=360 (body spans y 352..366)
  · no solid on the agenda interactable (55-56, 19-20)
  · solid furniture lines walls or forms desk pods with ≥2-tile aisles
"""

HALL_X0, HALL_Y0, HALL_X1, HALL_Y1 = 31, 12, 78, 23
EAST_X0, EAST_Y0, EAST_X1, EAST_Y1 = 72, 2, 78, 11


def decorate(ctx, phase: str) -> None:
    if phase == "floor":
        _paint_floor(ctx)
    elif phase == "furniture":
        _furnish(ctx)
    else:
        raise ValueError(f"hq_hall: unknown phase {phase!r}")


def _paint_floor(ctx) -> None:
    # Cream wall-to-wall on the open hall + east alcove. Meeting-room interiors
    # are owned by hq_rooms456 — leave them alone.
    ctx.fill_pattern(HALL_X0, HALL_Y0, HALL_X1, HALL_Y1, ctx.FLOOR_CREAM)
    ctx.fill_pattern(EAST_X0, EAST_Y0, EAST_X1, EAST_Y1, ctx.FLOOR_CREAM)
    # South entrance thresholds sat on the outdoor path; pave them cream.
    ctx.fill_pattern(49, 24, 50, 24, ctx.FLOOR_CREAM)
    ctx.fill_pattern(58, 24, 59, 24, ctx.FLOOR_CREAM)
    # Small accent rugs only (no giant saturated parquet — room 3's lesson).
    ctx.fill_pattern(32, 20, 38, 22, ctx.FLOOR_PARQUET)  # SW breakout
    ctx.fill_pattern(70, 20, 75, 22, ctx.FLOOR_PARQUET)  # SE lounge
    ctx.fill_pattern(73, 3, 77, 5, ctx.FLOOR_TEAL)  # coffee bay
    ctx.fill_pattern(32, 14, 35, 15, ctx.FLOOR_SLATE)  # printer corner
    ctx.fill_pattern(52, 21, 55, 22, ctx.FLOOR_SLATE)  # reception pad


def _furnish(ctx) -> None:
    # Modern open-plan startup office: desk pods with monitors, printer/filing,
    # wall boards, breakout sofas, coffee point, plants, a small reception at
    # the south doors. Wall decor first (insertion order = draw order).

    # ── East service alcove (coffee / kitchenette) ──────────────────────────
    # Tall wall props sit at x=77 (not 78): 32px sprites spill ±1 tile and
    # would claim stone artery columns 79-80 if flush against the east wall.
    ctx.furn("f_lz_window_blinds", 73, 2, False)
    ctx.furn("f_lz_ac", 76, 2, False)
    ctx.furn("f_lz_counter", 73, 3, True)
    ctx.furn("f_lz_fridge", 76, 3, True)
    ctx.furn("f_lz_fruit_bowl", 74, 4, False)
    ctx.furn("f_lz_plant_small", 72, 5, True)
    ctx.furn("f_lz_bookshelf_tall", 77, 5, True)
    ctx.furn("f_lz_basket", 72, 8, True)
    ctx.furn("f_lz_vending_shelf", 77, 8, True)
    ctx.furn("f_lz_bar_stool", 73, 6, True)
    ctx.furn("f_lz_bar_stool", 74, 6, True)
    ctx.furn("f_lz_plant", 77, 10, True)

    # ── North wall of the open hall (y=12, against rooms 4/5/6) ─────────────
    # Door gaps 36-37 / 49-50 / 63-64 stay empty. Decor-only so y=12-13 walks.
    ctx.furn("f_lz_pinboard", 32, 12, False)
    ctx.furn("f_lz_window_blinds", 34, 12, False)
    ctx.furn("f_lz_poster_grid", 39, 12, False)
    ctx.furn("f_lz_art_small", 41, 12, False)
    ctx.furn("f_lz_board", 42, 12, False)
    ctx.furn("f_lz_string_lights", 44, 12, False)
    ctx.furn("f_lz_ac", 46, 12, False)
    ctx.furn("f_lz_pinboard", 52, 12, False)
    ctx.furn("f_lz_window_blinds", 54, 12, False)
    ctx.furn("f_lz_poster_grid", 60, 12, False)
    ctx.furn("f_lz_string_lights", 62, 12, False)
    ctx.furn("f_lz_board", 66, 12, False)
    ctx.furn("f_lz_window_blinds", 69, 12, False)
    ctx.furn("f_lz_pinboard", 74, 12, False)
    ctx.furn("f_lz_ac", 77, 12, False)

    # ── West wall — printer / filing corner + storage run ───────────────────
    # Tall props at x=32 (not 31): 32px bodies spill west into artery col 30.
    # Bins are walk-past clutter (non-solid). Crate sits east of the pc tower
    # so their bottom-anchored bodies no longer share tile (34, 15).
    ctx.furn("f_lz_filing", 32, 14, True)
    ctx.furn("f_lz_pc_tower", 34, 14, True)
    ctx.furn("f_lz_boxes", 35, 14, False)
    # Crate west of room-4 door col (36-37): body at col 36 spills into the
    # E2E vertical approach, so park it at 35,16 under the pc tower.
    ctx.furn("f_lz_crate", 35, 16, True)
    ctx.furn("f_lz_bookshelf_tall", 32, 17, True)
    ctx.furn("f_lz_bin", 33, 17, False)
    ctx.furn("f_lz_shelf_white", 32, 19, True)
    ctx.furn("f_lz_plant_small", 31, 21, True)

    # ── West desk pod (x=40-46) ─────────────────────────────────────────────
    # Desk run at y=15. Chairs are visual only (non-solid): table bodies
    # already claim the sit tile, so solid chairs always overlap.
    # Starts at x=40 so columns 36-37 (room-4 door) keep a ≥2-tile approach.
    ctx.furn("f_lz_table", 40, 15, True)
    ctx.furn("f_lz_computer", 41, 15, True)
    ctx.furn("f_lz_table_books", 42, 15, True)
    ctx.furn("f_lz_computer", 43, 15, True)
    ctx.furn("f_lz_table_cup", 44, 15, True)
    ctx.furn("f_lz_computer", 45, 15, True)
    ctx.furn("f_lz_table", 46, 15, True)
    ctx.furn("f_lz_chair", 40, 16, False)
    ctx.furn("f_lz_chair", 42, 16, False)
    ctx.furn("f_lz_chair", 44, 16, False)
    ctx.furn("f_lz_chair", 46, 16, False)
    ctx.furn("f_lz_plant_small", 47, 15, True)
    ctx.furn("f_lz_papers", 41, 16, False)
    ctx.furn("f_lz_books", 43, 16, False)

    # ── Hot-desk pair under the wall (east of room-5 door, west of agenda) ──
    # y=14 only — corridor y=12-13 stays free. Columns 49-50 stay clear.
    # Stools non-solid (same tuck-under-table rule as chairs).
    ctx.furn("f_lz_table", 52, 14, True)
    ctx.furn("f_lz_computer", 53, 14, True)
    ctx.furn("f_lz_table_books", 54, 14, True)
    ctx.furn("f_lz_stool", 52, 15, False)
    ctx.furn("f_lz_stool", 54, 15, False)
    ctx.furn("f_lz_books", 53, 15, False)

    # ── "Today's Agenda" — freestanding board north of the interactable ─────
    # Interactable owns 55-56, 19-20; board at y=17 so its 32px body (which
    # reaches y+1) stays clear of the prompt rect.
    ctx.furn("f_lz_whiteboard", 55, 17, True)
    ctx.furn("f_lz_pinboard", 53, 18, False)
    ctx.furn("f_lz_plant_small", 57, 18, True)

    # ── East desk pod (x=66-72) ─────────────────────────────────────────────
    # Columns 63-64 left clear for room-6 door approach. Chairs non-solid.
    ctx.furn("f_lz_plant_small", 65, 15, True)
    ctx.furn("f_lz_table", 66, 15, True)
    ctx.furn("f_lz_computer", 67, 15, True)
    ctx.furn("f_lz_table_books", 68, 15, True)
    ctx.furn("f_lz_computer", 69, 15, True)
    ctx.furn("f_lz_table_cup", 70, 15, True)
    ctx.furn("f_lz_computer", 71, 15, True)
    ctx.furn("f_lz_table", 72, 15, True)
    ctx.furn("f_lz_chair", 66, 16, False)
    ctx.furn("f_lz_chair", 68, 16, False)
    ctx.furn("f_lz_chair", 70, 16, False)
    ctx.furn("f_lz_chair", 72, 16, False)
    ctx.furn("f_lz_papers", 67, 16, False)
    ctx.furn("f_lz_books2", 69, 16, False)

    # ── East wall of the open hall — storage + greenery ─────────────────────
    # x=77 (not 78) keeps 32px bodies off artery col 79. Bin is clutter.
    # Plant is walk-past greenery (non-solid).
    ctx.furn("f_lz_shelf_white", 77, 14, True)
    ctx.furn("f_lz_bin", 76, 14, False)
    ctx.furn("f_lz_filing", 77, 16, True)
    ctx.furn("f_lz_bookshelf_tall", 77, 18, True)
    ctx.furn("f_lz_plant", 78, 21, False)

    # ── SW breakout lounge (parquet rug) ────────────────────────────────────
    # Console + armchair kept west of col 36 and north of the y=360 E2E band
    # (32px bodies at y=21 reach y=360). Console at 35,20 sits above the sofa.
    ctx.furn("f_lz_painting", 32, 19, False)
    ctx.furn("f_lz_sofa_gray", 33, 21, True)
    ctx.furn("f_lz_console", 35, 20, True)
    ctx.furn("f_lz_armchair_gray", 39, 20, True)
    ctx.furn("f_lz_side_table", 32, 22, False)
    ctx.furn("f_lz_floor_lamp", 31, 23, True)
    ctx.furn("f_lz_plant_small", 39, 23, True)

    # ── Mid-hall collab (south of west desk pod) ────────────────────────────
    # Compact 2-stool + low wood console. Clear of door columns 49-50.
    ctx.furn("f_lz_rug_olive", 42, 19, False)
    ctx.furn("f_lz_console", 43, 19, True)
    ctx.furn("f_lz_stool", 42, 20, True)
    ctx.furn("f_lz_stool", 44, 20, True)
    ctx.furn("f_lz_books", 43, 18, False)

    # ── Second desk pair east of agenda (fills the x=60-62 void) ────────────
    # Same language as the main pods so it reads "more desks", not a random
    # lounge chair. Columns 58-59 (entrance) and 63-64 (room-6 E2E column)
    # stay clear of solid bodies for the full hall height.
    # Chairs non-solid (tucked under tables). Plant sits east of the door col.
    ctx.furn("f_lz_table", 60, 18, True)
    ctx.furn("f_lz_computer", 61, 18, True)
    ctx.furn("f_lz_table_books", 62, 18, True)
    ctx.furn("f_lz_chair", 60, 19, False)
    ctx.furn("f_lz_chair", 62, 19, False)
    ctx.furn("f_lz_plant_small", 65, 18, True)
    ctx.furn("f_lz_papers", 61, 19, False)

    # ── Reception desk between the two south entrances ──────────────────────
    # One tile north of the slate pad so 32px bodies bottom out at y=344 and
    # miss the E2E y=360 forecourt band. Columns 49-50 and 58-59 clear.
    # East plant is non-solid (would hit the agenda prompt if solid at y=20,
    # and the y=360 band if solid at y=21). Chair non-solid under the desk.
    ctx.furn("f_lz_table", 52, 20, True)
    ctx.furn("f_lz_computer", 53, 20, True)
    ctx.furn("f_lz_table_cup", 54, 20, True)
    ctx.furn("f_lz_chair", 53, 21, False)
    ctx.furn("f_lz_plant_small", 51, 20, True)
    ctx.furn("f_lz_plant_small", 55, 21, False)
    ctx.furn("f_lz_papers", 54, 21, False)

    # ── SE lounge nook (parquet rug, east of entrance 58-59) ────────────────
    # x=70+ leaves a ≥2-tile gap from column 59. Lamp nudged east so palm
    # body no longer shares (76, 23).
    ctx.furn("f_lz_sofa_2seat", 71, 21, True)
    ctx.furn("f_lz_side_table", 73, 21, False)
    ctx.furn("f_lz_armchair_white", 74, 21, True)
    ctx.furn("f_lz_floor_lamp", 77, 22, True)

    # ── South wall greenery framing both entrances ──────────────────────────
    # Plants on the artery belt (tx 56-63) and sideboard near it: small plants
    # are walk-past; sideboard sits one tile east so body misses artery 63.
    ctx.furn("f_lz_plant", 42, 23, True)
    ctx.furn("f_lz_sideboard", 45, 23, True)
    ctx.furn("f_lz_plant_small", 47, 23, True)
    # gap 49-50
    ctx.furn("f_lz_plant_small", 51, 23, True)
    ctx.furn("f_lz_plant_small", 54, 23, True)
    ctx.furn("f_lz_plant_small", 56, 23, False)
    # gap 58-59
    ctx.furn("f_lz_plant_small", 61, 23, False)
    ctx.furn("f_lz_sideboard", 65, 23, True)
    ctx.furn("f_lz_plant", 68, 23, True)
    ctx.furn("f_lz_plant_small", 70, 23, True)
    ctx.furn("f_lz_palm", 74, 23, True)

    # ── Loose floor clutter (non-solid) ─────────────────────────────────────
    ctx.furn("f_lz_plant_pot", 41, 22, False)
    ctx.furn("f_lz_plant_pot", 62, 22, False)
    ctx.furn("f_lz_papers", 72, 19, False)
    ctx.furn("f_lz_books2", 70, 18, False)
    ctx.furn("f_lz_art_small", 48, 12, False)
