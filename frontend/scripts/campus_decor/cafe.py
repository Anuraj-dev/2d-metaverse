"""Cafe / lounge terrace (SW) — outdoor LimeZu art pass.

District bounds: x=1..55, y=62..88. Stone terrace: x=5..47, y=63..80.
An OUTDOOR paved terrace (no walls): a short service counter on its west edge,
two table settings well clear of each other, and open stone everywhere else.
The middle of the terrace is deliberately empty — it is where players walk and
gather.

Frozen path arteries that cut the terrace (solid bodies must not land on them):
  park path x=29–30, hostel spur x=34–35 (see maps.test.ts PRD 25.33).

Layout (named clusters only):
  · service counter — west edge x=5..9 on the slate service bay, stools tucked in
  · table settings  — NW (15,66), SE (41,75)
  · park-path gate  — a planter either side of the x=29–30 mouth
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
    ctx.fill_pattern(5, 65, 9, 73, ctx.FLOOR_SLATE)


def _furnish(ctx) -> None:
    # ── Cluster: service counter (west terrace edge, on the slate bay) ───────
    # A compact serving point at x=6 (solids claim cols 5–7), customer stools
    # at x=8, and queueing space from x=10 east.
    ctx.furn("f_lz_counter", 6, 67, True)
    ctx.furn("f_lz_display_cab", 6, 71, True)
    ctx.furn("f_lz_stool_wood", 8, 68, True)
    ctx.furn("f_lz_stool_wood", 8, 71, True)

    # ── Cluster: table setting NW ───────────────────────────────────────────
    ctx.furn("f_lz_table_cafe", 15, 66, True)
    ctx.furn("f_lz_chair_side", 13, 66, True)
    ctx.furn("f_lz_chair_wood", 17, 66, True)

    # ── Cluster: table setting SE ───────────────────────────────────────────
    ctx.furn("f_lz_table_food", 41, 75, True)
    ctx.furn("f_lz_chair_side", 39, 75, True)
    ctx.furn("f_lz_chair_wood", 43, 75, True)

    # ── Landmark: park-path gateway into the terrace (path mouth x=29–30) ───
    ctx.furn("f_lz_plant_small", 28, 64, True)
    ctx.furn("f_lz_plant_small", 31, 64, True)
