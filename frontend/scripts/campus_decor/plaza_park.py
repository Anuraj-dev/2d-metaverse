"""plaza_park — outdoor props for the central plaza + NW park.

The plaza is the campus's main public room: a 96x35 sheet of paving where
players spawn, walk between districts and gather. Its defining feature is
open ground. Props exist only where they mark something — a portal, a door,
a path junction — or where they make one small place worth standing in.
Everything else stays bare paving.

Outdoor vocabulary, and nothing else: benches, palms, planters, bins, and a
lamp post at a junction. No indoor furniture and no wall-hung sprite ever
touches outdoor ground — those belong inside a building, against a wall.

Geometry it has to live with (all frozen):
  Plaza  x=12..107, y=26..60   Park  x=1..28, y=1..55
  Auditorium interior is x>=82, y<=43 — its south wall is y=44 with the
  door at x=98-99; the HQ south wall is y=24 with doors at x=49-50, 58-59.
  Spawn (60,44) · portal_east (27-28,43-44) · info_board_plaza (18-19,38-39)
  Welcome desk (16,38) · water cooler (65,33) · ground labels (64,45)
  (69,47) (64,50) (56,52) — all kept clear.
  E-W artery y=43-45 · N-S arteries x=29-30, x=56-63, x=79-80, and x=34-35
  south of y=46. The generator's own grass islands and trees fill the west
  end of the plaza; that end needs no props of its own.
"""


def decorate(ctx, phase: str) -> None:
    if phase == "floor":
        # Outdoor floors stay grass/stone — no LimeZu interior floor paint.
        pass
    elif phase == "furniture":
        _furnish(ctx)
    else:
        raise ValueError(f"plaza_park: unknown phase {phase!r}")


def _furnish(ctx) -> None:
    # ── Park: grove rest stop ─────────────────────────────────────────────
    # Two benches facing each other across a clearing between the trees.
    # The only seating in the park.
    ctx.furn("f_lz_bench_gold", 8, 19, True)
    ctx.furn("f_lz_bench_gold", 8, 23, True)

    # ── Park: west path gateway ───────────────────────────────────────────
    # A matched palm either side of the stone path (y=43-45) where it leaves
    # the plaza and enters the park lawn — a landmark, not a hedge.
    ctx.furn("f_lz_palm", 3, 41, True)
    ctx.furn("f_lz_palm", 3, 47, True)

    # ── Plaza: portal rest stop ───────────────────────────────────────────
    # Benches facing each other just east of the portal (27-28,43-44), off
    # the portal path and off both arteries, so arrivals have somewhere to
    # wait.
    ctx.furn("f_lz_bench_gold", 32, 37, True)
    ctx.furn("f_lz_bench_gold", 32, 41, True)

    # ── Plaza: HQ west door planters ──────────────────────────────────────
    # A planter each side of the door approach (x=49-50), marking the
    # entrance from the open paving. The east door sits on the N-S artery
    # and stays completely clear.
    ctx.furn("f_lz_plant", 47, 26, True)
    ctx.furn("f_lz_plant", 52, 26, True)

    # ── Plaza: crossing lamp posts ────────────────────────────────────────
    # A matched pair flanking the north approach to the main crossing of the
    # two arteries. The floor labels handle wayfinding south of it.
    ctx.furn("f_lz_floor_lamp", 55, 41, True)
    ctx.furn("f_lz_floor_lamp", 64, 41, True)

    # ── Plaza: water-cooler stop ──────────────────────────────────────────
    # The cooler at (65,33) is the reason to stand here; a bin and a bench
    # beside it turn it into a place.
    ctx.furn("f_lz_bin", 67, 33, True)
    ctx.furn("f_lz_bench_gold", 69, 33, True)

    # ── Plaza: auditorium entrance planters ───────────────────────────────
    # Framing the south door of the auditorium (x=98-99, y=44); the door
    # approach itself stays open.
    ctx.furn("f_lz_plant", 95, 47, True)
    ctx.furn("f_lz_plant", 102, 47, True)

    # ── Plaza: south-east shade cluster ───────────────────────────────────
    # One planted group in the far south-east so the corner has a horizon
    # line; the paving between it and the crossing stays empty.
    ctx.furn("f_lz_palm", 90, 55, True)
    ctx.furn("f_lz_palm", 93, 57, True)
    ctx.furn("f_lz_plant_small", 88, 57, True)

    # ── Plaza: south path junction planters ───────────────────────────────
    # Marking where the south path (x=34-35, down to the hostel) meets the
    # south plaza — one planter each side, corridor left clear.
    ctx.furn("f_lz_plant", 32, 52, True)
    ctx.furn("f_lz_plant", 38, 52, True)
