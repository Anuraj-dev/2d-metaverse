"""Coworking deck (SE) — open-plan LimeZu art pass.

Open-air wood deck painted by gen_campus (FLOOR_ACC at x=57..118, y=62..88).
The only wall line in the district is the map edge at x=119, so the east column
is the sole place a prop may hug a wall; everything else must earn its place by
belonging to a named cluster.

The space is a handful of desk pods and one standing/meeting pod on a slate bay,
separated by wide empty deck. That empty deck is the point — it is where players
walk and gather. Floor mats mark the pods; the rest stays bare.

CRITICAL: full-height arcade approach artery at x=79..80. A 32px solid body
spans its centre tile ±1, so no solid prop centre sits on x=77..82. Keep that
corridor completely clear for the spawn→Game Arcade walk.
"""

# Inclusive deck bounds.
CW_X0, CW_Y0, CW_X1, CW_Y1 = 57, 62, 118, 88


def decorate(ctx, phase: str) -> None:
    if phase == "floor":
        # Mats mark the clusters and nothing else — bare deck reads as walkable.
        ctx.fill_pattern(86, 78, 95, 81, ctx.FLOOR_SLATE)  # meeting-pod bay
        ctx.fill_pattern(102, 65, 105, 67, ctx.FLOOR_CREAM)  # NE desk-bank mat
        ctx.fill_pattern(70, 70, 72, 72, ctx.FLOOR_CREAM)  # mid-west carrel mat
        ctx.fill_pattern(107, 82, 113, 83, ctx.FLOOR_CREAM)  # SE lounge nook
    elif phase == "furniture":
        # ── Landmarks ─────────────────────────────────────────────────────
        # One palm at the deck's NW corner; two planters flanking the arcade
        # corridor as wayfinding for the spawn→arcade walk.
        ctx.furn("f_lz_palm", 58, 62, True)
        ctx.furn("f_lz_plant_small", 75, 72, True)
        ctx.furn("f_lz_plant_small", 84, 72, True)
        ctx.furn("f_lz_plant", 100, 76, True)  # planter break between east pods

        # ── West desk pod A — double desk ─────────────────────────────────
        ctx.furn("f_lz_pc_tower", 58, 70, True)
        ctx.furn("f_lz_computer", 59, 70, True)
        ctx.furn("f_lz_table_books", 60, 70, True)
        ctx.furn("f_lz_chair", 59, 72, True)
        ctx.furn("f_lz_chair", 60, 72, True)

        # ── West desk pod B — second pair, 3-tile aisle from A ────────────
        ctx.furn("f_lz_table_cup", 64, 70, True)
        ctx.furn("f_lz_computer", 65, 70, True)
        ctx.furn("f_lz_chair", 64, 72, True)
        ctx.furn("f_lz_stool", 65, 72, True)

        # ── Mid-west carrel pod (cream mat, west of the corridor) ─────────
        ctx.furn("f_lz_computer", 70, 70, True)
        ctx.furn("f_lz_table", 71, 70, True)
        ctx.furn("f_lz_chair", 70, 72, True)
        ctx.furn("f_lz_chair", 71, 72, True)

        # ── East desk pod C — three-module run ────────────────────────────
        ctx.furn("f_lz_computer", 86, 65, True)
        ctx.furn("f_lz_table", 87, 65, True)
        ctx.furn("f_lz_table_books", 88, 65, True)
        ctx.furn("f_lz_chair", 86, 67, True)
        ctx.furn("f_lz_chair", 87, 67, True)
        ctx.furn("f_lz_chair", 88, 67, True)

        # ── NE desk bank — three modules on the cream mat ─────────────────
        ctx.furn("f_lz_computer", 102, 65, True)
        ctx.furn("f_lz_table", 103, 65, True)
        ctx.furn("f_lz_table_books", 104, 65, True)
        ctx.furn("f_lz_chair", 102, 67, True)
        ctx.furn("f_lz_chair", 103, 67, True)
        ctx.furn("f_lz_chair", 104, 67, True)

        # ── Standing / meeting pod (slate bay) ────────────────────────────
        ctx.furn("f_lz_table_green", 87, 79, True)
        ctx.furn("f_lz_table_study", 91, 79, True)
        ctx.furn("f_lz_stool", 87, 81, True)
        ctx.furn("f_lz_stool", 89, 81, True)
        ctx.furn("f_lz_stool", 91, 81, True)
        ctx.furn("f_lz_stool", 93, 81, True)

        # ── SE desk pod D — south-east pair ───────────────────────────────
        ctx.furn("f_lz_computer", 104, 76, True)
        ctx.furn("f_lz_table_books", 105, 76, True)
        ctx.furn("f_lz_chair", 104, 78, True)
        ctx.furn("f_lz_chair", 105, 78, True)
        ctx.furn("f_lz_bin", 106, 78, True)

        # ── East storage run — against the map-edge wall at x=119 ─────────
        ctx.furn("f_lz_lockers", 117, 70, True)
        ctx.furn("f_lz_filing", 117, 75, True)
        ctx.furn("f_lz_bookshelf", 117, 80, True)

        # ── SE lounge group — the deck's one soft-seating cluster ─────────
        ctx.furn("f_lz_sofa_white", 108, 82, True)
        ctx.furn("f_lz_armchair", 112, 82, True)
    else:
        raise ValueError(f"coworking: unknown phase {phase!r}")
