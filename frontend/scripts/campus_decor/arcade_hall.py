"""Game Arcade hall — LimeZu art pass (games lounge).

Geometry it has to live with (all frozen):
  interior  x=68..86, y=95..107      door gap  x=78-81 on the north wall (y=94)
  cabinets  f_arcade_snake @ (71,96), f_arcade_flappy @ (76,96)
            each pairs with a 2×4 interactable (snake 71-72 / flappy 76-77, y=96-99)
  board     ttt table (72,102) seats (70,102)(74,102);
            c4  table (72,105) seats (70,105)(74,105)
  stage     arcade_zone covers the full interior (not a placement constraint)

Walkability rules the placement below obeys (player body is 18px; tiles are 16px,
so every lane must be ≥2 tiles):
  · cols 78-81 stay free of solid bodies — door spine from the threshold south
  · rows 98-99 under both cabinet interactables stay clear (play stance)
  · the board-table block (x=70-74, y=102-105) is untouched; approach stays open
    from the east (x≥76) and from the north (y=100-101 cross-aisle)
  · solids line the walls; open floor only gets non-solid clutter / rugs
  · solid=False props have ZERO collision — safe on door spine, next to cabinets,
    mid-room, over board approaches

Floor note: gen_campus builds the arcade shell (tan + moss runners) AFTER the
district floor phase, so cream paint in phase='floor' is overwritten. Floors
are therefore re-applied at the start of phase='furniture' (still only ground
tiles — never walls / seats / interactables).
"""

AH_X0, AH_Y0, AH_X1, AH_Y1 = 68, 95, 86, 107  # interior, inclusive


def decorate(ctx, phase: str) -> None:
    if phase == "floor":
        # Nothing: gen_campus builds the arcade shell after this phase and would
        # overwrite anything painted here. The floor is painted in 'furniture'.
        pass
    elif phase == "furniture":
        _paint_floor(ctx)  # must re-run — see module docstring
        _furnish(ctx)
    else:
        raise ValueError(f"arcade_hall: unknown phase {phase!r}")


def _paint_floor(ctx) -> None:
    # Cream wall-to-wall. Accents stay small — board rug under the two tables,
    # snack bay SE, centre lounge mat so the mid-room isn't blank cream.
    ctx.fill_pattern(AH_X0, AH_Y0, AH_X1, AH_Y1, ctx.FLOOR_CREAM)
    ctx.fill_pattern(71, 102, 73, 105, ctx.FLOOR_PARQUET)  # under board tables only
    ctx.fill_pattern(84, 105, 86, 107, ctx.FLOOR_SLATE)  # snack bay (SE)
    ctx.fill_pattern(78, 101, 82, 104, ctx.FLOOR_PARQUET)  # centre lounge mat
    # Door gap: shell paves stone; cream threshold so the entrance reads as room.
    ctx.fill_pattern(78, 94, 81, 94, ctx.FLOOR_CREAM)


def _furnish(ctx) -> None:
    # Games lounge: cabinets = north focus, board tables = SW, snack = SE,
    # soft seating + centre clutter so the room is not an empty box with a border.
    # Cols 78-81 never solid. Rows 98-99 under cabinets stay free of solids.

    # ── North wall dressing (non-solid) ───────────────────────────────────
    ctx.furn("f_lz_poster_grid", 68, 95, False)
    ctx.furn("f_lz_string_lights", 70, 95, False)
    ctx.furn("f_lz_board", 72, 95, False)  # high-score strip L of TV
    ctx.furn("f_lz_tv", 73, 95, False)
    ctx.furn("f_lz_string_lights", 74, 95, False)
    ctx.furn("f_lz_chalkboard", 75, 95, False)  # tournament board between cabs
    # Fairy lights over the door span (non-solid, door spine stays walkable).
    ctx.furn("f_lz_string_lights", 79, 95, False)
    ctx.furn("f_lz_window_blinds", 82, 95, False)
    ctx.furn("f_lz_pinboard", 84, 95, False)
    ctx.furn("f_lz_poster_grid", 86, 95, False)

    # North-wall solids on free columns only (not 71-72 / 76-77 / 78-81).
    ctx.furn("f_lz_plant_small", 68, 96, True)
    ctx.furn("f_lz_floor_lamp_blue", 69, 96, True)
    ctx.furn("f_lz_plant_small", 82, 96, True)

    # ── Cabinet spectators + play-area clutter (all non-solid) ────────────
    # Stools flank the play stance; solid=False so approach rows stay open.
    ctx.furn("f_lz_stool", 70, 99, False)  # west of snake
    ctx.furn("f_lz_bar_stool", 73, 99, False)  # between cabinets
    ctx.furn("f_lz_stool_wood", 75, 99, False)  # between / flappy
    ctx.furn("f_lz_stool", 77, 99, False)  # east of flappy
    ctx.furn("f_lz_papers", 70, 97, False)
    ctx.furn("f_lz_basket", 73, 97, False)
    ctx.furn("f_lz_fruit_bowl", 74, 97, False)

    # ── Centre feature (non-solid) — breaks the blank cream field ─────────
    # Rug + low table + planter pair + stools under/near the door spine.
    # Zero collision: players walk straight through the door aisle.
    ctx.furn("f_lz_rug_beige", 79, 101, False)
    ctx.furn("f_lz_coffee_table", 80, 103, False)
    ctx.furn("f_lz_books", 80, 103, False)
    ctx.furn("f_lz_papers", 81, 103, False)
    ctx.furn("f_lz_plant_pot", 78, 102, False)
    ctx.furn("f_lz_plant_pot", 82, 102, False)
    ctx.furn("f_lz_stool", 79, 104, False)
    ctx.furn("f_lz_stool_wood", 81, 104, False)
    # Standing sign / freestanding board east of centre (still non-solid).
    ctx.furn("f_lz_board", 83, 99, False)

    # ── Board-table spectators + table clutter (all non-solid) ────────────
    ctx.furn("f_lz_stool", 75, 102, False)  # east of ttt
    ctx.furn("f_lz_stool_wood", 75, 105, False)  # east of c4
    ctx.furn("f_lz_bar_stool", 76, 103, False)
    ctx.furn("f_lz_papers", 71, 103, False)
    ctx.furn("f_lz_books2", 73, 104, False)
    ctx.furn("f_lz_rug_olive", 71, 100, False)  # north of board bay

    # ── East wall — snack / soda corner (reads as a cluster) ──────────────
    # Vending is 2-wide; no second solid fridge neighbour on the same tiles.
    ctx.furn("f_lz_vending_shelf", 85, 96, True)
    ctx.furn("f_lz_fridge", 86, 98, True)
    ctx.furn("f_lz_shelf_jars", 85, 98, False)  # counter clutter
    ctx.furn("f_lz_table_cup", 84, 98, False)
    ctx.furn("f_lz_stool", 84, 99, False)  # snack stools (non-solid)
    ctx.furn("f_lz_stool_wood", 84, 100, False)
    ctx.furn("f_lz_basket", 86, 100, True)
    ctx.furn("f_lz_fruit_bowl", 85, 100, False)
    ctx.furn("f_lz_boxes", 86, 103, False)
    ctx.furn("f_lz_crate", 85, 104, False)  # non-solid floor crate by bay
    ctx.furn("f_lz_drawer_row", 86, 105, True)
    ctx.furn("f_lz_basket_lid", 85, 106, False)
    ctx.furn("f_lz_bin", 86, 107, True)

    # ── East lounge — sofa faces west toward the games ────────────────────
    # 3-seat body at x=84 stays east of the door spine (78-81). y=101 leaves
    # y=100 as the cross-aisle from the door into the lounge.
    ctx.furn("f_lz_rug_blue", 83, 100, False)
    ctx.furn("f_lz_sofa_gray", 84, 101, True)
    ctx.furn("f_lz_side_table", 83, 103, False)
    ctx.furn("f_lz_ottoman", 83, 105, False)  # footrest — non-solid
    ctx.furn("f_lz_sofa_2seat", 84, 107, True)
    ctx.furn("f_lz_floor_lamp", 82, 107, True)
    # Non-solid: small plant beside sofa; solid body claimed the loveseat's
    # bottom-anchored tiles (85,107)/(85,108). Decoration only.
    ctx.furn("f_lz_plant_small", 85, 107, False)

    # ── West wall — greenery + wall clutter ───────────────────────────────
    ctx.furn("f_lz_painting2", 68, 97, False)
    ctx.furn("f_lz_pinboard", 68, 99, False)
    ctx.furn("f_lz_plant_small", 68, 100, True)
    ctx.furn("f_lz_boxes", 69, 101, False)  # non-solid — solid crate overlapped plant
    ctx.furn("f_lz_bin", 68, 103, True)
    ctx.furn("f_lz_board", 68, 104, False)
    ctx.furn("f_lz_painting", 68, 105, False)
    ctx.furn("f_lz_plant", 68, 107, True)
    ctx.furn("f_lz_boxes", 69, 107, False)

    # ── South wall — sideboard + soft storage facing the cabinets ─────────
    # Row 106 left as the south aisle past the board tables (solids only on
    # the wall line). Sideboard body stays west of the door spine.
    ctx.furn("f_lz_sideboard", 76, 107, True)
    ctx.furn("f_lz_books2", 76, 107, False)
    ctx.furn("f_lz_plant_pot", 77, 107, False)
    ctx.furn("f_lz_bin", 74, 107, True)

    # ── Mid-room floor clutter (non-solid) — lived-in arcade ──────────────
    ctx.furn("f_lz_table_cup", 82, 100, False)
    ctx.furn("f_lz_basket", 77, 106, False)
    ctx.furn("f_lz_rug_red", 82, 97, False)  # NE accent by snack approach
