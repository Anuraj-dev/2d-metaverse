"""HQ open-plan office hall — LimeZu art pass (north building).

The hall reads as a working floor: two desk runs facing each other across an
empty central aisle, a hot-desk pair under the north wall, the "Today's Agenda"
board, and a small reception between the two south doors. Everything else is
floor — the middle of the hall is where players walk and gather, so it stays
clear. Storage and wall decor hug the walls; the plaza-facing south wall gets
two planted landmarks, nothing more.

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
    # South entrance thresholds sit on the outdoor path; pave them cream.
    ctx.fill_pattern(49, 24, 50, 24, ctx.FLOOR_CREAM)
    ctx.fill_pattern(58, 24, 59, 24, ctx.FLOOR_CREAM)
    # Accent pads mark the two service spots only — the open floor stays cream.
    ctx.fill_pattern(73, 3, 77, 5, ctx.FLOOR_TEAL)  # coffee bay
    ctx.fill_pattern(32, 14, 35, 15, ctx.FLOOR_SLATE)  # print corner
    ctx.fill_pattern(52, 21, 55, 22, ctx.FLOOR_SLATE)  # reception pad


def _furnish(ctx) -> None:
    # Wall decor first (insertion order = draw order).

    # ── Cluster: coffee point, east service alcove ──────────────────────────
    # Tall wall props sit at x=77 (not 78): 32px sprites spill ±1 tile and
    # would claim stone artery columns 79-80 if flush against the east wall.
    ctx.furn("f_lz_counter", 73, 3, True)
    ctx.furn("f_lz_fridge", 76, 3, True)
    ctx.furn("f_lz_fruit_bowl", 74, 4, False)
    ctx.furn("f_lz_stool_wood", 73, 6, True)
    ctx.furn("f_lz_stool_wood", 74, 6, True)
    ctx.furn("f_lz_plant", 77, 10, True)

    # ── North wall of the open hall (y=12, against rooms 4/5/6) ─────────────
    # Four pieces across a 46-tile wall, spaced between the door gaps
    # 36-37 / 49-50 / 63-64. Decor-only so the y=12-13 corridor walks.
    ctx.furn("f_lz_pinboard", 32, 12, False)
    ctx.furn("f_lz_board", 46, 12, False)
    ctx.furn("f_lz_poster_grid", 60, 12, False)
    ctx.furn("f_lz_ac", 74, 12, False)

    # ── Cluster: print corner, west wall ────────────────────────────────────
    # Tall props at x=32 (not 31): 32px bodies spill west into artery col 30.
    ctx.furn("f_lz_filing", 32, 14, True)
    ctx.furn("f_lz_pc_tower", 34, 14, True)
    ctx.furn("f_lz_boxes", 35, 14, False)

    # ── Cluster: west desk pod (x=41-45) ────────────────────────────────────
    # Desk run at y=15. Chairs are visual only (non-solid): table bodies
    # already claim the sit tile, so solid chairs always overlap.
    # Starts at x=41 so columns 36-37 (room-4 door) keep a ≥2-tile approach.
    ctx.furn("f_lz_table", 41, 15, True)
    ctx.furn("f_lz_computer", 42, 15, True)
    ctx.furn("f_lz_table_books", 43, 15, True)
    ctx.furn("f_lz_computer", 44, 15, True)
    ctx.furn("f_lz_table_cup", 45, 15, True)
    ctx.furn("f_lz_chair", 41, 16, False)
    ctx.furn("f_lz_chair", 43, 16, False)
    ctx.furn("f_lz_chair", 45, 16, False)

    # ── Cluster: hot-desk pair (east of room-5 door, west of the agenda) ────
    # y=14 only — corridor y=12-13 stays free. Columns 49-50 stay clear.
    # Stools non-solid (same tuck-under-table rule as chairs).
    ctx.furn("f_lz_table", 52, 14, True)
    ctx.furn("f_lz_computer", 53, 14, True)
    ctx.furn("f_lz_table_books", 54, 14, True)
    ctx.furn("f_lz_stool", 52, 15, False)
    ctx.furn("f_lz_stool", 54, 15, False)

    # ── "Today's Agenda" — freestanding board north of the interactable ─────
    # Interactable owns 55-56, 19-20; board at y=17 so its 32px body (which
    # reaches y+1) stays clear of the prompt rect, and the floor in front of
    # the board stays empty so players can walk up to it.
    ctx.furn("f_lz_whiteboard", 55, 17, True)

    # ── Cluster: east desk pod (x=67-71) ────────────────────────────────────
    # Columns 63-64 left clear for the room-6 door approach. Chairs non-solid.
    ctx.furn("f_lz_table", 67, 15, True)
    ctx.furn("f_lz_computer", 68, 15, True)
    ctx.furn("f_lz_table_books", 69, 15, True)
    ctx.furn("f_lz_computer", 70, 15, True)
    ctx.furn("f_lz_table_cup", 71, 15, True)
    ctx.furn("f_lz_chair", 67, 16, False)
    ctx.furn("f_lz_chair", 69, 16, False)
    ctx.furn("f_lz_chair", 71, 16, False)

    # ── East wall — team shelving ───────────────────────────────────────────
    # x=77 (not 78) keeps the 32px body off artery col 79.
    ctx.furn("f_lz_bookshelf_tall", 77, 18, True)

    # ── Cluster: reception desk between the two south entrances ─────────────
    # One tile north of the slate pad so 32px bodies bottom out at y=344 and
    # miss the E2E y=360 forecourt band. Columns 49-50 and 58-59 clear.
    # Stool non-solid under the desk.
    ctx.furn("f_lz_table", 52, 20, True)
    ctx.furn("f_lz_computer", 53, 20, True)
    ctx.furn("f_lz_table_cup", 54, 20, True)
    ctx.furn("f_lz_stool", 53, 21, False)

    # ── South wall landmarks flanking the two entrances ─────────────────────
    ctx.furn("f_lz_plant", 42, 23, True)
    ctx.furn("f_lz_palm", 74, 23, True)
