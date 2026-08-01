"""Auditorium / stage hall (NE) — LimeZu art pass.

A lecture hall, not a lounge: a bare walkable stage at the north end, a block of
identical audience chairs facing it, and almost nothing else. The room's whole
job is that a presenter can stand anywhere on the stage and an audience can sit
and walk between the banks without snagging on furniture.

Geometry it has to live with (all frozen):
  interior     x=82..117, y=2..43     door gap  x=98-99 on the south wall (y=44)
  presenter    x=90..110, y=2..15     (broadcast podium)
  stage zone   x=82..117, y=16..43    (audience floor — broadcast-eligible too)
  screen point tile (99, 5)           (visual anchor only)
  no seats / doorZones / roomBounds   (public walk-in hall)

Also lives with (not ours — do not touch / do not stack solids on):
  gen_campus   f_clock @ (117, 28) on the east wall
  plaza_park   assorted props around y=30-34 and y=40 (shared checkout)

The stage (x=90..110, y=2..15) carries NO solid props at all — a presenter walks
the full pad and the apron in front of it. It reads as a stage entirely from its
edges: the slate floor pad, the projector screen hung flush on the north wall,
and a proscenium leg (drape, planter, stage light) standing in each wing at
x=88 / x=112, just outside the rect. Nothing goes back inside it.

Walkability (player body 18px > 16px tile → lanes must be ≥2 tiles):
  · centre aisle  x=97..100  clear from the south door up through the house
  · side aisles   x=83..84 and x=115..116  clear — the few wall solids hug
    x=82 / x=117 and use 1-tile-wide sprites so they never claim an aisle column
  · cross aisles  between seat banks ≥2 rows free
  · apron y=16..20 is a clear firebreak between stage and the first chair bank
"""

AUD_X0, AUD_Y0, AUD_X1, AUD_Y1 = 82, 2, 117, 43


def decorate(ctx, phase: str) -> None:
    if phase == "floor":
        # Cream house floor wall-to-wall. The stage reads as a stage through the
        # slate pad, not through props — a small pad under the screen, not the
        # whole presenter zone.
        ctx.fill_pattern(AUD_X0, AUD_Y0, AUD_X1, AUD_Y1, ctx.FLOOR_CREAM)
        ctx.fill_pattern(94, 8, 104, 13, ctx.FLOOR_SLATE)  # presenter pad
        ctx.fill_pattern(98, 44, 99, 44, ctx.FLOOR_CREAM)  # door threshold
    elif phase == "furniture":
        # ── Stage backdrop: projector screen ─────────────────────────────────
        # Two 32px boards butt into one 4-tile screen strip on the north wall,
        # centred over the screen anchor at (99, 5). Non-solid and flush to the
        # wall — the entire presenter zone stays walkable.
        ctx.furn("f_lz_board", 98, 2, False)
        ctx.furn("f_lz_board", 100, 2, False)

        # ── Proscenium legs (x=88 / x=112) ───────────────────────────────────
        # The stage reads as a stage from its edges, never from its middle. Each
        # leg is a drape on the north wall, a tall planter mid-wing and a stage
        # light at the downstage corner, stacked on one column so the pair
        # brackets the presenter zone like a proscenium arch.
        #
        # x=88 / x=112 are the last columns whose 32/48px bodies stay clear of
        # the presenter rect: a 32px body claims tx-1..tx+1, so 88 spans 87..89
        # and 112 spans 111..113. Do not move these inward.
        ctx.furn("f_lz_window_curtains", 88, 2, False)
        ctx.furn("f_lz_window_curtains", 112, 2, False)
        ctx.furn("f_lz_plant", 88, 9, True)
        ctx.furn("f_lz_plant", 112, 9, True)
        ctx.furn("f_lz_floor_lamp", 88, 13, True)
        ctx.furn("f_lz_floor_lamp_blue", 112, 13, True)

        # ── Side-wall glazing ────────────────────────────────────────────────
        # Two windows per side wall along the audience run, on the wall column
        # (82 / 117). The side walls carry nothing else.
        ctx.furn("f_lz_window", 82, 22, False)
        ctx.furn("f_lz_window", 82, 34, False)
        ctx.furn("f_lz_window", 117, 22, False)
        ctx.furn("f_lz_window", 117, 34, False)

        # ── South entrance: notice boards ────────────────────────────────────
        # Flanking the door gap (x=98-99) on the last interior row, so arrivals
        # read them on the way in. The foyer floor itself stays bare.
        ctx.furn("f_lz_pinboard", 95, 43, False)
        ctx.furn("f_lz_poster_grid", 103, 43, False)

        # ── Audience seating ─────────────────────────────────────────────────
        # One chair type, banks facing the stage, centre aisle x=97..100 (the
        # door is 98-99) and side aisles x=83..84 / x=115..116 left clear.
        #
        # Chair pitch is 3 tiles (48 px): lz_chair body is 16*0.8=12.8 wide, so
        # body-to-body gap is 35.2 px (≥26). A 2-tile pitch only leaves ~19 px
        # and players scrape every seat row.

        # Bank 1 (y=21)
        ctx.furn("f_lz_chair", 85, 21, True)
        ctx.furn("f_lz_chair", 88, 21, True)
        ctx.furn("f_lz_chair", 91, 21, True)
        ctx.furn("f_lz_chair", 94, 21, True)
        ctx.furn("f_lz_chair", 103, 21, True)
        ctx.furn("f_lz_chair", 106, 21, True)
        ctx.furn("f_lz_chair", 109, 21, True)
        ctx.furn("f_lz_chair", 112, 21, True)

        # Bank 2 (y=24)
        ctx.furn("f_lz_chair", 85, 24, True)
        ctx.furn("f_lz_chair", 88, 24, True)
        ctx.furn("f_lz_chair", 91, 24, True)
        ctx.furn("f_lz_chair", 94, 24, True)
        ctx.furn("f_lz_chair", 103, 24, True)
        ctx.furn("f_lz_chair", 106, 24, True)
        ctx.furn("f_lz_chair", 109, 24, True)
        ctx.furn("f_lz_chair", 112, 24, True)

        # Cross-aisle y=26-27. Bank 3 (y=29).
        ctx.furn("f_lz_chair", 85, 29, True)
        ctx.furn("f_lz_chair", 88, 29, True)
        ctx.furn("f_lz_chair", 91, 29, True)
        ctx.furn("f_lz_chair", 94, 29, True)
        ctx.furn("f_lz_chair", 103, 29, True)
        ctx.furn("f_lz_chair", 106, 29, True)
        ctx.furn("f_lz_chair", 109, 29, True)
        ctx.furn("f_lz_chair", 112, 29, True)

        # Bank 4 (y=33) — clear of the plaza checkout props at y=30-32.
        ctx.furn("f_lz_chair", 85, 33, True)
        ctx.furn("f_lz_chair", 88, 33, True)
        ctx.furn("f_lz_chair", 91, 33, True)
        ctx.furn("f_lz_chair", 94, 33, True)
        ctx.furn("f_lz_chair", 103, 33, True)
        ctx.furn("f_lz_chair", 106, 33, True)
        ctx.furn("f_lz_chair", 109, 33, True)
        ctx.furn("f_lz_chair", 112, 33, True)

        # Back bank (y=37) — shorter; the foyer opens below it.
        ctx.furn("f_lz_chair", 88, 37, True)
        ctx.furn("f_lz_chair", 91, 37, True)
        ctx.furn("f_lz_chair", 94, 37, True)
        ctx.furn("f_lz_chair", 103, 37, True)
        ctx.furn("f_lz_chair", 106, 37, True)
        ctx.furn("f_lz_chair", 109, 37, True)
    else:
        raise ValueError(f"auditorium: unknown phase {phase!r}")
