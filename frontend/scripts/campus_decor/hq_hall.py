"""Cauvery Hostel shared hall — intentionally open multiplayer floor.

The three private rooms own the meeting tables and sit-enabled chairs. The
shared hall keeps two compact computer banks, mirrored at the extreme west and
east edges, plus the functional "Today's Agenda" board. The wide centre remains
circulation and gathering space, so the layout feels furnished without putting
another workstation in anyone's route.

Geometry it has to live with (all frozen):
  building interior   x=31..78, y=2..23
  meeting rooms 4/5/6 x=30..71, y=1..12  (hq_rooms456 owns their interiors)
  usable hall         x=31..78, y=12..23
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
  · computer banks stay inside x=31..35 and x=74..78, away from door spines
  · no decorative furniture occupies the centre hall or east strip
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
    # Mirrored slate pads give the two computer banks equal visual weight while
    # keeping the cream centre continuous and open.
    ctx.fill_pattern(31, 14, 35, 18, ctx.FLOOR_SLATE)
    ctx.fill_pattern(74, 14, 78, 18, ctx.FLOOR_SLATE)


def _furnish(ctx) -> None:
    # Mirrored computer banks. The key order reverses on the east side so the
    # silhouettes are true reflections around the hall centreline x=54.5.
    # Padded armchairs are visual-only: the tables carry collision, while the
    # seats stay visually clear and never become another obstacle.
    ctx.furn("f_lz_table", 32, 16, True)
    ctx.furn("f_lz_computer", 33, 16, True)
    ctx.furn("f_lz_table_books", 34, 16, True)
    for tx in (32, 33, 34):
        ctx.furn("f_lz_armchair", tx, 18, False)

    ctx.furn("f_lz_table_books", 74, 16, True)
    ctx.furn("f_lz_computer", 75, 16, True)
    ctx.furn("f_lz_table", 76, 16, True)
    for tx in (74, 75, 76):
        ctx.furn("f_lz_armchair", tx, 18, False)

    # "Today's Agenda" visual on the north wall row (wall-hung only). The
    # interactable prompt stays at 55-56, 19-20 so players walk up on open floor.
    ctx.furn("f_lz_whiteboard", 55, 12, False)
