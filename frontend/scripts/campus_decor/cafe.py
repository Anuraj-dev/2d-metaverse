"""Cafe / lounge terrace (SW) — outdoor LimeZu art pass.

District bounds: x=1..55, y=62..88. Stone terrace: x=5..47, y=63..80.
This is an OUTDOOR terrace (no walls). Furniture is clustered into islands
with ≥2-tile walkable aisles — not a uniform grid.

Frozen path arteries that cut the terrace (solid bodies must not land on them):
  park path x=29–30, hostel spur x=34–35 (see maps.test.ts PRD 25.33).

Pre-authored 2×2 grass-in-stone clearings on the terrace (gen_campus CLR_*):
  (10–11, 68–69), (24–25, 74–75), (40–41, 70–71). Treated as patio planter
  pads — plant them, never park a table on top.

Layout sketch (islands, not walls):
  · west edge  — coffee bar / service run + bar stools
  · NW / SE    — soft-seating corners (sofas + low tables)
  · west floor — mixed cafe table clusters (2-tops + a 4-top + offset 2-tops)
  · east floor — staggered tables + greenery toward the trees
  · N–S strip  x=28..36 left open as the dual-path spine
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
    # coffee bar — low-contrast slate, not a wall-to-wall rug (room 3's mistake).
    # CLR grass pads sit at x=10–11, so this strip does not cover them.
    ctx.fill_pattern(5, 64, 9, 78, ctx.FLOOR_SLATE)


def _furnish(ctx) -> None:
    # ── West coffee bar (service run along the west terrace edge) ───────────
    # Solids claim ~cols 5–7; bar stools at x=9; service approach from x=10+.
    ctx.furn("f_lz_counter", 6, 65, True)
    ctx.furn("f_lz_kiosk", 6, 68, True)
    ctx.furn("f_lz_fridge", 6, 71, True)
    ctx.furn("f_lz_vending_shelf", 6, 74, True)
    ctx.furn("f_lz_display_cab", 6, 77, True)
    # Bar stools (red mushroom + blue tripod "lamp" which is a bar stool).
    ctx.furn("f_lz_bar_stool", 9, 65, True)
    ctx.furn("f_lz_lamp", 9, 67, True)
    ctx.furn("f_lz_bar_stool", 9, 70, True)  # skip y=68–69 (CLR planter pad)
    ctx.furn("f_lz_lamp", 9, 72, True)
    ctx.furn("f_lz_bar_stool", 9, 75, True)
    # Service clutter (walkable) + a barrel keg at the south end of the bar.
    ctx.furn("f_lz_basket", 8, 72, False)
    ctx.furn("f_lz_fruit_bowl", 8, 74, False)
    ctx.furn("f_lz_stool_wood", 8, 78, True)

    # CLR pad (10–11, 68–69) — patio planter between bar and lounge.
    ctx.furn("f_lz_plant_small", 10, 68, True)
    ctx.furn("f_lz_plant_small", 11, 69, True)

    # ── NW soft-seating corner ──────────────────────────────────────────────
    # Island roughly x=13–19, y=64–67; aisle to bar at x=10–12 (with planter).
    ctx.furn("f_lz_rug_beige", 15, 65, False)
    ctx.furn("f_lz_sofa_tan", 15, 65, True)
    ctx.furn("f_lz_console", 15, 67, True)
    ctx.furn("f_lz_side_table", 18, 67, False)
    ctx.furn("f_lz_floor_lamp", 13, 64, True)
    ctx.furn("f_lz_plant_small", 19, 64, True)

    # ── Lone 2-top north (offset, breaks the grid) ──────────────────────────
    ctx.furn("f_lz_table_cafe", 23, 65, True)
    ctx.furn("f_lz_chair_side", 21, 65, True)
    ctx.furn("f_lz_stool", 25, 65, True)

    # ── West table cluster A — two 2-tops ───────────────────────────────────
    # Island x=13–24, y=71–72 (south of the bar planter aisle).
    ctx.furn("f_lz_table_cafe", 15, 71, True)
    ctx.furn("f_lz_chair_side", 13, 71, True)
    ctx.furn("f_lz_chair_wood", 17, 71, True)
    ctx.furn("f_lz_table_food", 21, 71, True)
    ctx.furn("f_lz_stool", 19, 71, True)
    ctx.furn("f_lz_bar_stool", 23, 71, True)
    ctx.furn("f_lz_fruit_bowl", 21, 72, False)

    # ── CLR pad (24–25, 74–75) — mid-terrace planter ────────────────────────
    ctx.furn("f_lz_palm", 24, 74, True)

    # ── West mid 2-top (west of the mid planter, not on it) ─────────────────
    ctx.furn("f_lz_console", 20, 74, True)
    ctx.furn("f_lz_chair_wood", 18, 74, True)
    ctx.furn("f_lz_armchair", 22, 74, True)

    # ── West table cluster B — one larger 4-top (south-west) ────────────────
    # Island x=13–20, y=76–79.
    ctx.furn("f_lz_table_green", 16, 77, True)
    ctx.furn("f_lz_chair_side", 14, 77, True)
    ctx.furn("f_lz_chair_wood", 18, 77, True)
    ctx.furn("f_lz_chair", 15, 79, True)
    ctx.furn("f_lz_armchair", 17, 79, True)

    # ── East table cluster C — staggered 2-tops (north of the east CLR) ─────
    ctx.furn("f_lz_table_food", 40, 65, True)
    ctx.furn("f_lz_chair_wood", 38, 65, True)
    ctx.furn("f_lz_chair_side", 42, 65, True)

    ctx.furn("f_lz_table_cafe", 44, 67, True)
    ctx.furn("f_lz_bar_stool", 42, 67, True)
    ctx.furn("f_lz_stool", 46, 67, True)

    # CLR pad (40–41, 70–71) — east patio planter.
    ctx.furn("f_lz_plant", 40, 70, True)

    # ── East 2-top south of the east planter ────────────────────────────────
    ctx.furn("f_lz_console", 44, 70, True)
    ctx.furn("f_lz_chair_side", 42, 70, True)
    ctx.furn("f_lz_armchair", 46, 70, True)

    # ── SE soft-seating corner (neutral palette) ────────────────────────────
    # Island x=38–45, y=73–79.
    ctx.furn("f_lz_rug_olive", 40, 75, False)
    ctx.furn("f_lz_sofa_2seat", 40, 74, True)
    ctx.furn("f_lz_armchair_white", 43, 74, True)
    ctx.furn("f_lz_console", 40, 76, True)
    ctx.furn("f_lz_side_table", 43, 76, False)
    ctx.furn("f_lz_floor_lamp_blue", 45, 74, True)
    ctx.furn("f_lz_plant_small", 38, 75, True)
    ctx.furn("f_lz_bin", 44, 78, True)

    # ── East-edge greenery + second drinks shelf (toward trees at x=49) ─────
    ctx.furn("f_lz_palm", 46, 64, True)
    ctx.furn("f_lz_vending_shelf", 46, 72, True)
    ctx.furn("f_lz_basket_lid", 44, 72, True)
    ctx.furn("f_lz_plant", 46, 76, True)
    ctx.furn("f_lz_palm", 46, 79, True)

    # ── Terrace-edge planters defining the stone perimeter ──────────────────
    # Skip the path notches at x=29–35.
    ctx.furn("f_lz_plant_small", 7, 63, True)
    ctx.furn("f_lz_plant_small", 11, 63, True)
    ctx.furn("f_lz_plant_small", 18, 63, True)
    ctx.furn("f_lz_plant_small", 24, 63, True)
    ctx.furn("f_lz_plant_small", 38, 63, True)
    ctx.furn("f_lz_plant_small", 44, 63, True)

    ctx.furn("f_lz_plant_small", 7, 80, True)
    ctx.furn("f_lz_plant_small", 12, 80, True)
    ctx.furn("f_lz_plant_small", 18, 80, True)
    ctx.furn("f_lz_plant_small", 24, 80, True)
    ctx.furn("f_lz_plant_small", 38, 80, True)
    ctx.furn("f_lz_plant_small", 44, 80, True)

    # Grass-margin accents just off the stone (still inside district bounds).
    ctx.furn("f_lz_plant", 3, 66, True)
    ctx.furn("f_lz_palm", 3, 74, True)
    ctx.furn("f_lz_plant_small", 3, 80, True)
    ctx.furn("f_lz_plant_small", 50, 68, True)
    ctx.furn("f_lz_plant_small", 50, 76, True)

    # String lights as edge decor (non-solid) — cafe ambience on the perimeter.
    ctx.furn("f_lz_string_lights", 10, 63, False)
    ctx.furn("f_lz_string_lights", 16, 63, False)
    ctx.furn("f_lz_string_lights", 40, 63, False)
    ctx.furn("f_lz_string_lights", 14, 80, False)
    ctx.furn("f_lz_string_lights", 40, 80, False)

    # South grass — casual benches (not a grid) + a barrel.
    ctx.furn("f_lz_bench_gold", 10, 83, True)
    ctx.furn("f_lz_bench_gold", 20, 85, True)
    ctx.furn("f_lz_bench_gold", 40, 83, True)
    ctx.furn("f_lz_plant_small", 14, 84, True)
    ctx.furn("f_lz_plant_small", 24, 86, True)
    ctx.furn("f_lz_plant_small", 44, 85, True)
    ctx.furn("f_lz_stool_wood", 46, 83, True)

    # North grass strip (y=62 is the district edge above the terrace).
    ctx.furn("f_lz_plant_small", 10, 62, True)
    ctx.furn("f_lz_plant_small", 20, 62, True)
    ctx.furn("f_lz_plant_small", 40, 62, True)
    ctx.furn("f_lz_plant_small", 46, 62, True)
