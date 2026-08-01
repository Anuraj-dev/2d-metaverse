"""Cafe / lounge terrace (SW) — outdoor LimeZu art pass.

District bounds: x=1..55, y=62..88. Stone terrace: x=5..47, y=63..80.
An OUTDOOR paved terrace (no walls): gold benches and planters on the west
service bay and two seating clusters, with open stone everywhere else.
The middle of the terrace is deliberately empty — it is where players walk and
gather. Indoor furniture is never used here.

Frozen path arteries that cut the terrace (solid bodies must not land on them):
  park path x=29–30, hostel spur x=34–35 (see maps.test.ts PRD 25.33).

Layout (named clusters only):
  · service bay    — west edge benches + bin/planter on the slate strip
  · seating        — NW (15,66), SE (41,75) benches with planters
  · park-path gate — a planter either side of the x=29–30 mouth
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
    # Outdoor vocabulary only: benches, planters, a bin, and planters.
    # Indoor counters/chairs/tables never ship on the open terrace.

    # ── Cluster: west service bay (slate strip) ─────────────────────────────
    ctx.furn("f_lz_bench_gold", 6, 68, True)
    ctx.furn("f_lz_bench_gold", 6, 71, True)
    ctx.furn("f_lz_bin", 8, 67, True)
    # Outdoor vocabulary: planters only — no indoor floor lamps on the terrace.
    ctx.furn("f_lz_plant_small", 8, 72, True)

    # ── Cluster: NW seating ─────────────────────────────────────────────────
    ctx.furn("f_lz_bench_gold", 15, 66, True)
    ctx.furn("f_lz_plant_small", 12, 64, True)
    ctx.furn("f_lz_plant_small", 18, 64, True)

    # ── Cluster: SE seating ─────────────────────────────────────────────────
    ctx.furn("f_lz_bench_gold", 41, 75, True)
    # Planters two tiles clear of the bench solid (bottom-anchored body).
    ctx.furn("f_lz_plant", 38, 73, True)
    ctx.furn("f_lz_plant", 44, 73, True)

    # ── Landmark: park-path gateway into the terrace (path mouth x=29–30) ───
    ctx.furn("f_lz_plant_small", 28, 64, True)
    ctx.furn("f_lz_plant_small", 31, 64, True)
