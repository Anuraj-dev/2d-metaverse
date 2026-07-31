"""Coworking deck (SE) — outdoor open-plan LimeZu art pass.

Open-air wood deck already painted by gen_campus (FLOOR_ACC at x=57..118,
y=62..88). No walls, seats, doors, or interactables — pure prop density.

CRITICAL: full-height arcade approach artery at x=79..80. A 32px solid body
spans its centre tile ±1, so no solid prop centre sits on x=77..82. Keep that
corridor completely clear for the spawn→Game Arcade walk.

Layout is islands + aisles (not a wall-line of identical desks): lounge NW,
varied desk pods west/east, a standing/meeting pod, edge storage, planters as
dividers. Every walkable lane stays ≥2 tiles (player body is 18px).
"""

# Inclusive deck bounds.
CW_X0, CW_Y0, CW_X1, CW_Y1 = 57, 62, 118, 88


def decorate(ctx, phase: str) -> None:
    if phase == "floor":
        # Wood deck stays FLOOR_ACC (outdoor base). Only tiny accent rugs —
        # room 3's saturated wall-to-wall parquet is the anti-pattern.
        ctx.fill_pattern(59, 64, 66, 66, ctx.FLOOR_PARQUET)  # lounge rug
        ctx.fill_pattern(86, 78, 95, 81, ctx.FLOOR_SLATE)  # meeting-pod bay (full island)
        ctx.fill_pattern(102, 65, 106, 67, ctx.FLOOR_CREAM)  # desk-bank mat
        ctx.fill_pattern(70, 70, 73, 72, ctx.FLOOR_CREAM)  # mid-west carrel mat
    elif phase == "furniture":
        # ── North edge: planters framing the deck ─────────────────────────
        # 32px props start at x≥58 so their body does not spill past x=57.
        ctx.furn("f_lz_palm", 58, 62, True)
        ctx.furn("f_lz_plant_small", 65, 62, True)
        ctx.furn("f_lz_plant_small", 72, 62, True)
        ctx.furn("f_lz_plant_small", 84, 62, True)
        ctx.furn("f_lz_palm", 92, 62, True)
        ctx.furn("f_lz_plant_small", 100, 62, True)
        ctx.furn("f_lz_plant_small", 108, 62, True)
        ctx.furn("f_lz_palm", 116, 62, True)

        # ── Corridor flanks (markers only — never solid centre on x=77..82)
        ctx.furn("f_lz_plant_small", 75, 64, True)
        ctx.furn("f_lz_plant_small", 75, 72, True)
        ctx.furn("f_lz_plant_small", 75, 80, True)
        ctx.furn("f_lz_plant_small", 75, 86, True)
        ctx.furn("f_lz_plant_small", 84, 64, True)
        ctx.furn("f_lz_plant_small", 84, 72, True)
        ctx.furn("f_lz_plant_small", 84, 80, True)
        ctx.furn("f_lz_plant_small", 84, 86, True)
        # Pinboard strips as freestanding dividers (decor — walkable).
        ctx.furn("f_lz_pinboard", 74, 68, False)
        ctx.furn("f_lz_pinboard", 85, 68, False)

        # ── NW lounge corner ──────────────────────────────────────────────
        # Lamp east of sofa so its body does not share tile 58 with the sofa.
        ctx.furn("f_lz_rug_beige", 61, 65, False)
        ctx.furn("f_lz_sofa_gray", 59, 64, True)
        ctx.furn("f_lz_armchair_gray", 63, 64, True)
        ctx.furn("f_lz_floor_lamp", 66, 64, True)
        ctx.furn("f_lz_plant_small", 68, 64, True)
        ctx.furn("f_lz_console", 61, 66, True)
        ctx.furn("f_lz_side_table", 58, 66, False)
        ctx.furn("f_lz_ottoman", 65, 66, True)
        ctx.furn("f_lz_books", 61, 66, False)

        # ── West desk pod A — double desk ─────────────────────────────────
        ctx.furn("f_lz_pc_tower", 58, 70, True)
        ctx.furn("f_lz_computer", 59, 70, True)
        ctx.furn("f_lz_table_books", 60, 70, True)
        ctx.furn("f_lz_chair", 59, 72, True)
        ctx.furn("f_lz_chair", 60, 72, True)

        # ── West desk pod B — second pair, 3-tile gap from A ──────────────
        ctx.furn("f_lz_table_cup", 64, 70, True)
        ctx.furn("f_lz_computer", 65, 70, True)
        ctx.furn("f_lz_chair", 64, 72, True)
        ctx.furn("f_lz_stool", 65, 72, True)
        ctx.furn("f_lz_globe", 66, 70, True)

        # ── Mid-west carrel island (toward corridor) ──────────────────────
        ctx.furn("f_lz_computer", 70, 70, True)
        ctx.furn("f_lz_table", 71, 70, True)
        ctx.furn("f_lz_chair", 70, 72, True)
        ctx.furn("f_lz_chair", 71, 72, True)

        # ── West study carrel + standing cluster (south row) ──────────────
        # study centre 63 → body 62-64, leaving cols 60-61 free of filing.
        ctx.furn("f_lz_table_study", 63, 76, True)
        ctx.furn("f_lz_chair", 63, 78, True)
        ctx.furn("f_lz_plant_small", 66, 76, True)
        ctx.furn("f_lz_desk_green", 68, 76, True)
        ctx.furn("f_lz_stool", 68, 78, True)
        ctx.furn("f_lz_table_green", 72, 76, True)
        ctx.furn("f_lz_bar_stool", 72, 78, True)
        ctx.furn("f_lz_stool", 74, 78, True)

        # ── West edge storage ─────────────────────────────────────────────
        ctx.furn("f_lz_filing", 58, 76, True)
        ctx.furn("f_lz_bookshelf_tall", 58, 81, True)
        ctx.furn("f_lz_poster_grid", 60, 81, False)  # noticeboard by shelves
        # Small plant (1-col body) keeps a ≥2-tile gap between boxes and the
        # loungeette sofa so the SW corner stays reachable.
        ctx.furn("f_lz_crate", 58, 85, True)
        ctx.furn("f_lz_boxes", 61, 85, True)
        ctx.furn("f_lz_plant_small", 64, 84, True)
        ctx.furn("f_lz_bin", 58, 87, True)

        # ── West south loungeette ─────────────────────────────────────────
        ctx.furn("f_lz_sofa_2seat", 68, 84, True)
        ctx.furn("f_lz_side_table", 70, 85, False)
        ctx.furn("f_lz_floor_lamp_blue", 71, 84, True)
        ctx.furn("f_lz_armchair", 73, 84, True)

        # ── East desk pod C — three-module run ────────────────────────────
        ctx.furn("f_lz_computer", 86, 65, True)
        ctx.furn("f_lz_table", 87, 65, True)
        ctx.furn("f_lz_table_books", 88, 65, True)
        ctx.furn("f_lz_chair", 86, 67, True)
        ctx.furn("f_lz_chair", 87, 67, True)
        ctx.furn("f_lz_chair", 88, 67, True)
        ctx.furn("f_lz_pc_tower", 89, 65, True)
        ctx.furn("f_lz_bin", 90, 67, True)

        # ── East desk pod D — study + lone computer (gap ≥2) ──────────────
        ctx.furn("f_lz_table_study", 93, 65, True)
        ctx.furn("f_lz_chair", 93, 67, True)
        ctx.furn("f_lz_computer", 97, 65, True)
        ctx.furn("f_lz_chair", 97, 67, True)
        ctx.furn("f_lz_plant_small", 95, 65, True)

        # Freestanding board as a mid-row divider under the north pods.
        ctx.furn("f_lz_whiteboard", 90, 70, True)
        ctx.furn("f_lz_poster_grid", 93, 70, False)

        # ── East long desk bank (far NE) — varied modules ─────────────────
        ctx.furn("f_lz_computer", 102, 65, True)
        ctx.furn("f_lz_table", 103, 65, True)
        ctx.furn("f_lz_table_cup", 104, 65, True)
        ctx.furn("f_lz_table_books", 105, 65, True)
        ctx.furn("f_lz_chair", 102, 67, True)
        ctx.furn("f_lz_chair", 103, 67, True)
        ctx.furn("f_lz_stool", 104, 67, True)
        ctx.furn("f_lz_chair", 105, 67, True)
        ctx.furn("f_lz_pc_tower", 106, 65, True)

        # Solo carrel east of bank (2-tile gap from tower at 106).
        ctx.furn("f_lz_table_green", 110, 65, True)
        ctx.furn("f_lz_chair", 110, 67, True)
        ctx.furn("f_lz_globe", 112, 65, True)

        # ── East mid L-pod (fills the barren band between banks & meeting) ─
        # Horizontal run + one south leg — reads as a small team island.
        ctx.furn("f_lz_computer", 96, 71, True)
        ctx.furn("f_lz_table_books", 97, 71, True)
        ctx.furn("f_lz_table_cup", 96, 73, True)
        ctx.furn("f_lz_chair", 98, 71, True)
        ctx.furn("f_lz_chair", 97, 73, True)
        ctx.furn("f_lz_plant_small", 99, 72, True)

        # ── Standing / meeting pod (slate bay) ────────────────────────────
        ctx.furn("f_lz_whiteboard", 88, 76, True)
        ctx.furn("f_lz_board", 92, 76, False)
        ctx.furn("f_lz_table_green", 87, 79, True)
        ctx.furn("f_lz_table_study", 91, 79, True)
        ctx.furn("f_lz_lectern", 94, 79, True)  # reading stand at the pod end
        ctx.furn("f_lz_stool", 87, 81, True)
        ctx.furn("f_lz_stool", 89, 81, True)
        ctx.furn("f_lz_bar_stool", 91, 81, True)
        ctx.furn("f_lz_stool", 93, 81, True)
        ctx.furn("f_lz_stool", 95, 81, True)
        ctx.furn("f_lz_plant_small", 96, 78, True)

        # ── Mid-east planter break ────────────────────────────────────────
        ctx.furn("f_lz_plant", 100, 76, True)
        ctx.furn("f_lz_palm", 101, 81, True)
        ctx.furn("f_lz_crate", 103, 73, True)

        # ── East desk pod E — south-east singles ──────────────────────────
        ctx.furn("f_lz_computer", 104, 76, True)
        ctx.furn("f_lz_table_books", 105, 76, True)
        ctx.furn("f_lz_chair", 104, 78, True)
        ctx.furn("f_lz_chair", 105, 78, True)
        ctx.furn("f_lz_desk_green", 108, 76, True)
        ctx.furn("f_lz_stool", 108, 78, True)
        ctx.furn("f_lz_bin", 106, 78, True)
        ctx.furn("f_lz_computer", 112, 76, True)
        ctx.furn("f_lz_chair", 112, 78, True)

        # ── SE soft lounge ────────────────────────────────────────────────
        ctx.furn("f_lz_rug_blue", 110, 82, False)
        ctx.furn("f_lz_sofa_white", 108, 82, True)
        ctx.furn("f_lz_armchair_white", 112, 82, True)
        ctx.furn("f_lz_console", 110, 84, True)
        ctx.furn("f_lz_floor_lamp", 106, 82, True)
        ctx.furn("f_lz_side_table", 114, 83, False)
        ctx.furn("f_lz_plant_small", 115, 82, True)

        # ── East edge storage / shelving ──────────────────────────────────
        ctx.furn("f_lz_shelf_white", 116, 65, True)
        ctx.furn("f_lz_lockers", 116, 70, True)
        ctx.furn("f_lz_filing", 116, 75, True)
        ctx.furn("f_lz_bookshelf", 116, 80, True)
        ctx.furn("f_lz_pinboard", 114, 70, False)
        ctx.furn("f_lz_boxes", 116, 85, True)
        ctx.furn("f_lz_crate", 113, 86, True)
        ctx.furn("f_lz_basket", 111, 86, True)

        # ── South edge planters ───────────────────────────────────────────
        ctx.furn("f_lz_plant_small", 62, 87, True)
        ctx.furn("f_lz_plant_small", 70, 87, True)
        ctx.furn("f_lz_plant_small", 86, 87, True)
        ctx.furn("f_lz_plant_small", 96, 87, True)
        ctx.furn("f_lz_palm", 104, 87, True)
        ctx.furn("f_lz_plant_small", 112, 87, True)

        # ── Sparse non-solid clutter (keep light — outdoor deck) ──────────
        ctx.furn("f_lz_books", 87, 66, False)
        ctx.furn("f_lz_books2", 104, 66, False)
        ctx.furn("f_lz_pinboard", 102, 70, False)
    else:
        raise ValueError(f"coworking: unknown phase {phase!r}")
