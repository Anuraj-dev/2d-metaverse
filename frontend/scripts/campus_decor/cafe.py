"""Cafe / lounge terrace (SW) — outdoor LimeZu art pass.

District bounds: x=1..55, y=62..88. Stone terrace: x=5..47, y=63..80.
An OUTDOOR paved terrace (no walls): a service counter run along its west edge,
four table settings well clear of each other, and open stone everywhere else.
The middle of the terrace is deliberately empty — it is where players walk and
gather.

Frozen path arteries that cut the terrace (solid bodies must not land on them):
  park path x=29–30, hostel spur x=34–35 (see maps.test.ts PRD 25.33).

Pre-authored 2×2 grass-in-stone clearings on the terrace (gen_campus CLR_*):
  (10–11, 68–69), (24–25, 74–75), (40–41, 70–71). Each is a patio planter pad
  and carries exactly one plant — never a table.

Layout (named clusters only):
  · service counter — west edge x=5..9 on the slate service bay, stools tucked in
  · table settings  — NW (15,66), SW (16,76), NE (40,66), SE (41,75)
  · planter pads    — one plant per CLR clearing
  · park-path gate  — a planter either side of the x=29–30 mouth
  · south lawn      — a bench either side of the path corridor
"""

# Inclusive district / terrace bounds (documentation only — gen_campus owns floors).
CAFE_X0, CAFE_Y0, CAFE_X1, CAFE_Y1 = 1, 62, 55, 88
TERR_X0, TERR_Y0, TERR_X1, TERR_Y1 = 5, 63, 47, 80


def decorate(ctx, phase: str) -> None:
    if phase == "floor":
        _paint_floor(ctx)
    elif phase == "furniture":
        _furnish(ctx)
    else:
        raise ValueError(f"cafe: unknown phase {phase!r}")


def _paint_floor(ctx) -> None:
    # Outdoor keeps the stone terrace. Only a thin service-bay strip under the
    # counter run — low-contrast slate that reads as the cafe's working side.
    # CLR grass pads sit at x=10–11, so this strip does not cover them.
    ctx.fill_pattern(5, 64, 9, 78, ctx.FLOOR_SLATE)


def _furnish(ctx) -> None:
    # ── Cluster: service counter (west terrace edge, on the slate bay) ───────
    # Serving run at x=6 (solids claim cols 5–7), customer stools at x=8,
    # approach and queueing space from x=10 east.
    ctx.furn("f_lz_counter", 6, 65, True)
    ctx.furn("f_lz_kiosk", 6, 68, True)
    ctx.furn("f_lz_fridge", 6, 71, True)
    ctx.furn("f_lz_vending_shelf", 6, 74, True)
    ctx.furn("f_lz_display_cab", 6, 77, True)
    ctx.furn("f_lz_stool_wood", 8, 65, True)
    ctx.furn("f_lz_stool_wood", 8, 68, True)
    ctx.furn("f_lz_stool_wood", 8, 71, True)

    # ── Cluster: table setting NW ───────────────────────────────────────────
    ctx.furn("f_lz_table_cafe", 15, 66, True)
    ctx.furn("f_lz_chair_side", 13, 66, True)
    ctx.furn("f_lz_chair_wood", 17, 66, True)
    ctx.furn("f_lz_chair", 15, 67, True)

    # ── Cluster: table setting SW ───────────────────────────────────────────
    ctx.furn("f_lz_table_food", 16, 76, True)
    ctx.furn("f_lz_chair_side", 14, 76, True)
    ctx.furn("f_lz_chair_wood", 18, 76, True)
    ctx.furn("f_lz_stool", 16, 77, True)

    # ── Cluster: table setting NE ───────────────────────────────────────────
    ctx.furn("f_lz_table_cafe", 40, 66, True)
    ctx.furn("f_lz_chair_side", 38, 66, True)
    ctx.furn("f_lz_chair_wood", 42, 66, True)
    ctx.furn("f_lz_chair", 40, 67, True)

    # ── Cluster: table setting SE ───────────────────────────────────────────
    ctx.furn("f_lz_table_food", 41, 75, True)
    ctx.furn("f_lz_chair_side", 39, 75, True)
    ctx.furn("f_lz_chair_wood", 43, 75, True)
    ctx.furn("f_lz_stool", 41, 76, True)

    # ── Planter pads (one plant per pre-authored CLR clearing) ──────────────
    ctx.furn("f_lz_plant_small", 10, 68, True)
    ctx.furn("f_lz_palm", 24, 74, True)
    ctx.furn("f_lz_palm", 40, 70, True)

    # ── Landmark: park-path gateway into the terrace (path mouth x=29–30) ───
    ctx.furn("f_lz_plant_small", 28, 64, True)
    ctx.furn("f_lz_plant_small", 31, 64, True)

    # ── South lawn: a bench either side of the path corridor ────────────────
    ctx.furn("f_lz_bench_gold", 26, 84, True)
    ctx.furn("f_lz_bench_gold", 38, 84, True)
