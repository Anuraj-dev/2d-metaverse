"""Auditorium / stage hall (NE) — LimeZu art pass.

Geometry it has to live with (all frozen):
  interior     x=82..117, y=2..43     door gap  x=98-99 on the south wall (y=44)
  presenter    x=90..110, y=2..15     (broadcast podium — keep walkable)
  stage zone   x=82..117, y=16..43    (audience floor — broadcast-eligible too)
  screen point tile (99, 5)           (visual anchor only; no solid on it)
  no seats / doorZones / roomBounds   (public walk-in hall)

Also lives with (not ours — do not touch / do not stack solids on):
  gen_campus   f_plant_big @ (105, 28), f_clock @ (95, 30)
  plaza_park   assorted props around y=30-34 and y=40 (shared checkout)

Walkability (player body 18px > 16px tile → lanes must be ≥2 tiles):
  · centre aisle  x=97..100  clear from the south door up through the house
    (lectern sits on the presenter pad at y=14, north of the house aisle)
  · side aisles   x=83..84 and x=115..116  clear — wall solids hug x=82 / x=117
    and use 1-tile-wide sprites so they do not claim the aisle columns
  · cross aisles  between seat banks ≥2 rows free
  · presenter apron keeps open walk around the lectern

The 40 legacy f_chair grid was removed; this module authors the hall from scratch.
"""

AUD_X0, AUD_Y0, AUD_X1, AUD_Y1 = 82, 2, 117, 43


def decorate(ctx, phase: str) -> None:
    if phase == "floor":
        # Cream house floor wall-to-wall. Stage apron is a SMALL slate pad under
        # the lectern only — not the whole presenter zone (room 3's giant-rug
        # lesson). Door threshold was bare grass; pave it.
        ctx.fill_pattern(AUD_X0, AUD_Y0, AUD_X1, AUD_Y1, ctx.FLOOR_CREAM)
        ctx.fill_pattern(94, 8, 104, 13, ctx.FLOOR_SLATE)  # small presenter pad
        ctx.fill_pattern(98, 44, 99, 44, ctx.FLOOR_CREAM)
    elif phase == "furniture":
        # ── North wall: curtains + projector screen behind (99, 5) ───────────
        # Boards are 32px (2 tiles) — space them so they butt, not stack. TV is
        # the lit centre panel. Curtains frame the run. All non-solid; (99, 5)
        # itself stays free of solids (the screen sits on the wall north of it).
        ctx.furn("f_lz_window_blinds", 83, 2, False)
        ctx.furn("f_lz_poster_grid", 86, 2, False)
        ctx.furn("f_lz_window_curtains", 92, 2, False)
        # 32px boards centred 2 tiles apart butt into one continuous screen strip.
        ctx.furn("f_lz_board", 97, 2, False)
        ctx.furn("f_lz_board", 99, 2, False)  # centre panel, directly north of (99, 5)
        ctx.furn("f_lz_board", 101, 2, False)
        ctx.furn("f_lz_window_curtains", 105, 2, False)
        ctx.furn("f_lz_poster_grid", 109, 2, False)
        ctx.furn("f_lz_window_blinds", 112, 2, False)
        ctx.furn("f_lz_chalkboard", 115, 2, False)
        ctx.furn("f_lz_string_lights", 99, 3, False)

        # ── Stage wings (outside presenter x=90..110) — AV / backstage ───────
        # 1-tile-wide solids on the wall columns only (82 / 117). Wider clutter
        # sits in the wing bays (x≤88 / x≥111), not in the side-aisle columns.
        ctx.furn("f_lz_floor_lamp", 82, 4, True)  # left PA tower
        ctx.furn("f_lz_plant_small", 82, 7, True)
        ctx.furn("f_lz_sideboard", 82, 10, True)
        ctx.furn("f_lz_plant_small", 82, 13, True)
        ctx.furn("f_lz_crate", 86, 5, True)
        # Was 88,5 — 32px bodies both claim col 87; nudge east so they sit side by side.
        ctx.furn("f_lz_boxes", 90, 5, True)

        ctx.furn("f_lz_floor_lamp_blue", 117, 4, True)  # right PA tower
        ctx.furn("f_lz_plant_small", 117, 7, True)
        ctx.furn("f_lz_bookshelf_tall", 117, 10, True)
        ctx.furn("f_lz_plant_small", 117, 13, True)
        ctx.furn("f_lz_crate", 113, 5, True)
        ctx.furn("f_lz_bin", 111, 5, True)

        # Stage speakers / lights flanking the screen (walkable around).
        ctx.furn("f_lz_floor_lamp", 93, 5, True)
        ctx.furn("f_lz_floor_lamp_blue", 105, 5, True)

        # ── Presenter end — lectern + panelist stools ────────────────────────
        # Sparse on purpose: presenter must still walk and broadcast. Pad sits
        # under the screen so the apron south of it (y=14-16) stays a clear
        # firebreak before the front VIP row.
        ctx.furn("f_lz_rug_blue", 99, 10, False)
        ctx.furn("f_lz_lectern", 99, 12, True)
        ctx.furn("f_lz_stool", 95, 12, True)  # panelist left
        ctx.furn("f_lz_stool", 103, 12, True)  # panelist right
        ctx.furn("f_lz_whiteboard", 91, 8, True)  # freestanding flip-chart
        ctx.furn("f_lz_globe", 107, 8, True)

        # ── West / east wall dressing (audience depth) — non-solid ───────────
        ctx.furn("f_lz_window", 82, 17, False)
        ctx.furn("f_lz_painting", 82, 22, False)
        ctx.furn("f_lz_pinboard", 82, 27, False)
        ctx.furn("f_lz_window", 82, 35, False)
        ctx.furn("f_lz_poster_grid", 82, 40, False)

        ctx.furn("f_lz_window", 117, 17, False)
        ctx.furn("f_lz_painting2", 117, 22, False)
        ctx.furn("f_lz_worldmap", 116, 27, False)
        ctx.furn("f_lz_window", 117, 35, False)
        ctx.furn("f_lz_pinboard", 116, 40, False)

        # ── Audience seating ─────────────────────────────────────────────────
        # Two wings, centre aisle x=97..100 (door is 98-99), side aisles free.
        # Banks face the stage. Staggered row lengths — not one uniform grid.
        # Leave space around f_plant_big (105,28) and plaza props near y=30-34.

        # Front VIP bank (y=18) — loveseats + armchairs, shorter than the house.
        ctx.furn("f_lz_sofa_2seat", 87, 18, True)
        ctx.furn("f_lz_armchair", 91, 18, True)
        ctx.furn("f_lz_armchair", 94, 18, True)
        ctx.furn("f_lz_armchair", 103, 18, True)
        ctx.furn("f_lz_armchair", 106, 18, True)
        ctx.furn("f_lz_sofa_2seat", 110, 18, True)

        # Bank 2 (y=21)
        ctx.furn("f_lz_chair", 85, 21, True)
        ctx.furn("f_lz_chair", 87, 21, True)
        ctx.furn("f_lz_chair", 89, 21, True)
        ctx.furn("f_lz_chair", 91, 21, True)
        ctx.furn("f_lz_chair", 93, 21, True)
        ctx.furn("f_lz_chair", 95, 21, True)
        ctx.furn("f_lz_chair", 102, 21, True)
        ctx.furn("f_lz_chair", 104, 21, True)
        ctx.furn("f_lz_chair", 106, 21, True)
        ctx.furn("f_lz_chair", 108, 21, True)
        ctx.furn("f_lz_chair", 110, 21, True)
        ctx.furn("f_lz_chair", 112, 21, True)

        # Bank 3 (y=24)
        ctx.furn("f_lz_chair", 85, 24, True)
        ctx.furn("f_lz_chair", 87, 24, True)
        ctx.furn("f_lz_chair", 89, 24, True)
        ctx.furn("f_lz_chair", 91, 24, True)
        ctx.furn("f_lz_chair", 93, 24, True)
        ctx.furn("f_lz_chair", 95, 24, True)
        ctx.furn("f_lz_chair", 102, 24, True)
        ctx.furn("f_lz_chair", 104, 24, True)
        ctx.furn("f_lz_chair", 106, 24, True)
        ctx.furn("f_lz_chair", 108, 24, True)
        ctx.furn("f_lz_chair", 110, 24, True)
        ctx.furn("f_lz_chair", 112, 24, True)

        # Cross-aisle y=26-27. Bank 4 at y=29 — gap for plant (105,28).
        ctx.furn("f_lz_chair", 85, 29, True)
        ctx.furn("f_lz_chair", 87, 29, True)
        ctx.furn("f_lz_chair", 89, 29, True)
        ctx.furn("f_lz_chair", 91, 29, True)
        ctx.furn("f_lz_chair", 93, 29, True)
        ctx.furn("f_lz_chair", 95, 29, True)
        ctx.furn("f_lz_chair", 102, 29, True)
        # skip 104-106 (plant)
        ctx.furn("f_lz_chair", 108, 29, True)
        ctx.furn("f_lz_chair", 110, 29, True)
        ctx.furn("f_lz_chair", 112, 29, True)
        ctx.furn("f_lz_chair", 114, 29, True)

        # Bank 5 (y=33) — clear of plaza clutter at y=30-32.
        ctx.furn("f_lz_chair", 85, 33, True)
        ctx.furn("f_lz_chair", 87, 33, True)
        ctx.furn("f_lz_chair", 89, 33, True)
        ctx.furn("f_lz_chair", 91, 33, True)
        ctx.furn("f_lz_chair", 93, 33, True)
        ctx.furn("f_lz_chair", 95, 33, True)
        ctx.furn("f_lz_chair", 102, 33, True)
        ctx.furn("f_lz_chair", 104, 33, True)
        ctx.furn("f_lz_chair", 106, 33, True)
        ctx.furn("f_lz_chair", 108, 33, True)
        ctx.furn("f_lz_chair", 110, 33, True)
        ctx.furn("f_lz_chair", 112, 33, True)

        # Back bank (y=37) — shorter; foyer opens below. Corner stools.
        ctx.furn("f_lz_stool", 85, 37, True)
        ctx.furn("f_lz_chair", 87, 37, True)
        ctx.furn("f_lz_chair", 89, 37, True)
        ctx.furn("f_lz_chair", 91, 37, True)
        ctx.furn("f_lz_chair", 93, 37, True)
        ctx.furn("f_lz_chair", 104, 37, True)
        ctx.furn("f_lz_chair", 106, 37, True)
        ctx.furn("f_lz_chair", 108, 37, True)
        ctx.furn("f_lz_chair", 110, 37, True)
        ctx.furn("f_lz_stool", 112, 37, True)

        # ── Foyer / south entrance ───────────────────────────────────────────
        # Corner dressing hugs the walls; centre 98-99 stays open. Wide plants
        # sit at the wall columns so side-aisle approach from the door is free.
        # Plants are non-solid: 32×48 bodies spill onto stone artery y=43 / outer
        # cols; walk-past clutter is the intended fix (density kept).
        ctx.furn("f_lz_plant", 82, 42, False)
        ctx.furn("f_lz_plant_small", 82, 40, True)
        ctx.furn("f_lz_plant", 117, 42, False)
        ctx.furn("f_lz_plant_small", 117, 40, True)
        # Sideboard/bookshelf were at y=43 — 32×32 bottom-anchored bodies claim
        # artery rows 43–44. Nudge one tile north of the artery belt (body → y=41–42).
        ctx.furn("f_lz_sideboard", 85, 41, True)
        ctx.furn("f_lz_bookshelf", 114, 41, True)
        ctx.furn("f_lz_floor_lamp", 90, 42, True)
        ctx.furn("f_lz_floor_lamp_blue", 109, 42, True)
        ctx.furn("f_lz_rug_olive", 93, 41, False)
        ctx.furn("f_lz_rug_olive", 106, 41, False)
        ctx.furn("f_lz_bin", 112, 41, True)
    else:
        raise ValueError(f"auditorium: unknown phase {phase!r}")
