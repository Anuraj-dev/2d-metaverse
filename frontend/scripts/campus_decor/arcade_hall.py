"""Game Arcade hall — LimeZu art pass (games room).

The room is small (19x13 interior) and holds three things, nothing else: the
two arcade cabinets on the north wall, the two board tables on a parquet mat
in the south-west, and a minimal snack point against the east wall. Two wall
sprites dress the cabinet line. The middle is deliberately empty spectator
floor.

Geometry it has to live with (all frozen):
  interior  x=68..86, y=95..107      door gap  x=78-81 on the north wall (y=94)
  cabinets  f_arcade_snake @ (71,96), f_arcade_flappy @ (76,96)
            each pairs with a 2x4 interactable (snake 71-72 / flappy 76-77, y=96-99)
  board     ttt table (72,102) seats (70,102)(74,102);
            c4  table (72,105) seats (70,105)(74,105)
  stage     arcade_zone covers the full interior (not a placement constraint)

Walkability rules the placement below obeys (player body is 18px; tiles are 16px,
so every lane must be >=2 tiles):
  · cols 78-81 stay free of solid bodies — door spine from the threshold south
  · rows 98-99 under both cabinet interactables stay clear (play stance)
  · the board-table block (x=70-74, y=102-105) carries no props at all; it is
    approached from the east (x>=76) and from the north (y=100-101 cross-aisle)
  · the room centre (x=76-83, y=100-106) is open floor — spectator space
  · every solid sits on the wall line; nothing solid stands in open floor

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
    # Cream wall-to-wall. Two accents only, both marking a function:
    # the parquet mat the board tables and their seats sit on, and the slate
    # tile of the snack corner. The centre stays plain cream.
    ctx.fill_pattern(AH_X0, AH_Y0, AH_X1, AH_Y1, ctx.FLOOR_CREAM)
    ctx.fill_pattern(70, 101, 74, 106, ctx.FLOOR_PARQUET)  # board-table mat
    ctx.fill_pattern(84, 95, 86, 99, ctx.FLOOR_SLATE)  # snack corner (E wall)
    # Door gap: shell paves stone; cream threshold so the entrance reads as room.
    ctx.fill_pattern(78, 94, 81, 94, ctx.FLOOR_CREAM)


def _furnish(ctx) -> None:
    # Cols 78-81 never solid. Rows 98-99 under the cabinets stay free of solids.

    # ── Cabinet wall dressing (non-solid, flush to the north wall) ────────
    ctx.furn("f_lz_poster_grid", 69, 95, False)  # poster left of the snake cab
    # Chalk scoreboard, hung in the gap between the two cabinet sprites
    # (snake ends at x=72.5, flappy starts at x=75.5).
    ctx.furn("f_lz_chalkboard", 74, 95, False)

    # ── Snack point (east wall) ───────────────────────────────────────────
    ctx.furn("f_lz_vending_shelf", 85, 96, True)
