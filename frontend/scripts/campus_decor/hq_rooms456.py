"""HQ meeting rooms 4–6 — LimeZu art pass.

Geometry is frozen (seats drive the meeting FSM; walls shared with the HQ
shell). This module only repaints floors and hangs furniture *around* the
existing four-seat cross + door.

  Room 4  interior x=32..42, y=3..10   door gap y=11, x=36..37
          seats (35,6) (39,6) (37,4) (37,8)   centre (37,6)
  Room 5  interior x=45..56, y=3..10   door gap y=11, x=49..50
          seats (48,6) (52,6) (50,4) (50,8)   centre (50,6)
  Room 6  interior x=59..70, y=3..10   door gap y=11, x=63..64
          seats (62,6) (66,6) (64,4) (64,8)   centre (64,6)

Walkability (player body 18px, tiles 16px → lanes ≥2 tiles):
  · north seat sits at y=4, so row y=3 is wall-decor only (non-solid) at the
    seat column; solid corner plants stay on the side walls;
  · south seats at y=8, door columns stay clear on y=9–10 so the approach
    aisle from the south door is open;
  · centre table is a single solid module at the room centre; E/W seats are
    two tiles out, so the ring around the table stays walkable.
Three rooms share the LimeZu language but get distinct characters so players
can tell them apart at a glance: strategy, lounge, library.
"""


def decorate(ctx, phase: str) -> None:
    if phase == "floor":
        # ── Room 4 — strategy / whiteboard ──────────────────────────────
        # Cream base + small slate accent under the table (cool, low-contrast).
        ctx.fill_pattern(32, 3, 42, 10, ctx.FLOOR_CREAM)
        ctx.fill_pattern(36, 5, 38, 7, ctx.FLOOR_SLATE)
        ctx.fill_pattern(36, 11, 37, 11, ctx.FLOOR_CREAM)  # door threshold

        # ── Room 5 — soft lounge ────────────────────────────────────────
        ctx.fill_pattern(45, 3, 56, 10, ctx.FLOOR_CREAM)
        ctx.fill_pattern(49, 5, 51, 7, ctx.FLOOR_TEAL)
        ctx.fill_pattern(49, 11, 50, 11, ctx.FLOOR_CREAM)

        # ── Room 6 — focus / library ────────────────────────────────────
        # Warm parquet under the study table — library wood, still a small rug.
        ctx.fill_pattern(59, 3, 70, 10, ctx.FLOOR_CREAM)
        ctx.fill_pattern(63, 5, 65, 7, ctx.FLOOR_PARQUET)
        ctx.fill_pattern(63, 11, 64, 11, ctx.FLOOR_CREAM)

    elif phase == "furniture":
        # ── Room 4 — strategy room ──────────────────────────────────────
        # Cool office: presentation board, blinds, pinboard, filing, papers.
        ctx.furn("f_lz_board", 33, 3, False)  # presentation screen, west of N seat
        ctx.furn("f_lz_window_blinds", 37, 3, False)  # office blinds above N seat
        ctx.furn("f_lz_pinboard", 40, 3, False)  # sticky notes, east of N seat
        ctx.furn("f_lz_plant_small", 32, 3, True)  # NW corner
        ctx.furn("f_lz_plant_small", 42, 3, True)  # NE corner
        ctx.furn("f_lz_table_books", 37, 6, True)  # papers on desk = strategy clutter
        # South wall flanks the door; columns 36–37 stay open.
        ctx.furn("f_lz_filing", 33, 10, True)  # west of door
        ctx.furn("f_lz_sideboard", 40, 10, True)  # east of door
        ctx.furn("f_lz_poster_grid", 42, 8, False)  # schedule grid on SE wall
        ctx.furn("f_lz_plant_small", 42, 10, True)  # SE green
        ctx.furn("f_lz_papers", 32, 8, False)  # desk-spill clutter by filing

        # ── Room 5 — soft lounge ────────────────────────────────────────
        # Warmer soft seating; still a real meeting table at centre.
        ctx.furn("f_lz_painting", 46, 3, False)
        ctx.furn("f_lz_window_curtains", 49, 3, False)  # draped window at N
        ctx.furn("f_lz_painting2", 53, 3, False)
        ctx.furn("f_lz_plant_small", 45, 3, True)  # NW
        ctx.furn("f_lz_plant_small", 56, 3, True)  # NE
        ctx.furn("f_lz_table", 50, 6, True)  # plain meeting table (lounge is soft around it)
        ctx.furn("f_lz_tv", 45, 5, False)  # wall TV on west wall
        ctx.furn("f_lz_string_lights", 56, 5, False)  # east-wall fairy lights
        # South wall: loveseat west of door, sideboard + palm east.
        ctx.furn("f_lz_sofa_2seat", 46, 10, True)
        ctx.furn("f_lz_side_table", 45, 9, False)  # round table tucked by sofa
        ctx.furn("f_lz_floor_lamp", 48, 10, True)  # between sofa and door gap
        ctx.furn("f_lz_sideboard", 53, 10, True)
        ctx.furn("f_lz_palm", 56, 10, True)  # SE palm
        ctx.furn("f_lz_ottoman", 56, 8, True)  # footstool under the lights

        # ── Room 6 — focus / library ────────────────────────────────────
        # Books + quiet study props. No freestanding lamps on the seat row —
        # those sprites read as stools and pin the west approach.
        ctx.furn("f_lz_bookshelf", 59, 3, True)  # NW stack
        ctx.furn("f_lz_worldmap", 63, 3, False)  # map above N seat
        ctx.furn("f_lz_window_wood", 66, 3, False)
        ctx.furn("f_lz_shelf_white", 69, 3, True)  # NE white shelf
        ctx.furn("f_lz_table_study", 64, 6, True)  # study desk as meeting table
        ctx.furn("f_lz_globe", 70, 5, True)  # east wall — keeps west approach open
        # South wall flanks door (63–64 clear).
        ctx.furn("f_lz_lectern", 60, 10, True)  # reading desk west of door
        ctx.furn("f_lz_floor_lamp", 62, 10, True)  # lamp just west of door gap
        ctx.furn("f_lz_sideboard", 67, 10, True)
        ctx.furn("f_lz_plant_small", 70, 10, True)  # SE
        ctx.furn("f_lz_books", 59, 8, False)  # floor clutter by west wall
        ctx.furn("f_lz_books2", 70, 8, False)  # matching clutter by east wall

    else:
        raise ValueError(f"hq_rooms456: unknown phase {phase!r}")
