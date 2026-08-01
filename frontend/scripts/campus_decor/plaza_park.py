"""plaza_park — outdoor props for the central plaza + NW park.

The plaza is the campus's main public room: a 96x35 sheet of paving where
players spawn, walk between districts and gather. Its defining feature is
open ground. The district pass adds only paired entrance planters; the park,
portal, crossing, water point and lawn need no extra furniture.

No indoor furniture and no wall-hung sprite ever touches outdoor ground —
those belong inside a building, against a wall.

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
    # ── Plaza: HQ west door planters ──────────────────────────────────────
    # A planter each side of the door approach (x=49-50), marking the
    # entrance from the open paving. The east door sits on the N-S artery
    # and stays completely clear.
    ctx.furn("f_lz_plant", 47, 26, True)
    ctx.furn("f_lz_plant", 52, 26, True)

    # ── Plaza: auditorium entrance planters ───────────────────────────────
    # Framing the south door of the auditorium (x=98-99, y=44); the door
    # approach itself stays open. Row 48, not 47: a bottom-anchored body on 47
    # reaches up into row 46, which is the corridor the E2E stage path walks.
    ctx.furn("f_lz_plant", 95, 48, True)
    ctx.furn("f_lz_plant", 102, 48, True)
