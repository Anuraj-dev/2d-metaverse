"""Auditorium / stage hall (NE) — LimeZu art pass.

A lecture hall, not a lounge: a broad walkable stage at the north end, a block
of identical audience chairs facing it, and almost nothing else. The room's
whole job is that a presenter can move freely around one speaking focal point
and an audience can sit and walk between the banks without snagging on props.

Geometry it has to live with (all frozen):
  interior     x=82..117, y=2..43     door gap  x=98-99 on the south wall (y=44)
  presenter    x=90..110, y=2..15     (broadcast podium)
  stage zone   x=82..117, y=16..43    (audience floor — presence/audio only)
  screen point tile (99, 5)           (visual anchor only)
  one local presenter seat, no doorZones / roomBounds (public walk-in hall)

Also lives with (not ours — do not touch / do not stack solids on):
  gen_campus   f_clock @ (117, 28) on the east wall
  plaza_park   assorted props around y=30-34 and y=40 (shared checkout)

The stage (x=90..110, y=2..15) carries NO solid props at all — a presenter walks
the full platform and the apron in front of it. It reads as a stage through the
broad slate surface, the projector screen and drapes hung flush on the north
wall, and one centred, non-solid lectern. Nothing blocks movement inside it.

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
        # Cream house floor wall-to-wall. The slate platform covers the full
        # presenter rectangle and meets the backdrop instead of floating as a
        # small rug in the middle of the room. One extra column on each side
        # visually joins it to the proscenium drapes.
        ctx.fill_pattern(AUD_X0, AUD_Y0, AUD_X1, AUD_Y1, ctx.FLOOR_CREAM)
        ctx.fill_pattern(89, 2, 111, 15, ctx.FLOOR_SLATE)
        ctx.fill_pattern(98, 44, 99, 44, ctx.FLOOR_CREAM)  # door threshold
    elif phase == "furniture":
        # ── Stage backdrop ───────────────────────────────────────────────────
        # The presenter platform (tiles 90-110 × 2-15) stays completely clear of
        # props so a presenter can stand anywhere. Drapes sit on the side walls
        # just outside that rectangle (x=88 / x=112).
        ctx.furn("f_lz_window_curtains", 88, 2, False)
        ctx.furn("f_lz_window_curtains", 112, 2, False)

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
