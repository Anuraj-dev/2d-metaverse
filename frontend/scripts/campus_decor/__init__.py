"""District art-pass plug-in seam for gen_campus.py.

Each district owns one module under this package. gen_campus builds walls, seats,
doors, interactables and the legacy furniture bulk, then hands a DecorContext to
every registered module (deterministic order). Modules may only paint the ground
layer and append furniture objects — never touch frozen geometry.

Two phases keep regeneration byte-identical with the pre-seam layout:
  floor      — after make_room / structural floors, BEFORE grass-variety RNG
               (painting a former grass tile after the scatter desyncs the seed)
  furniture  — at the historical furniture-list position (IDs are
               20000 + insertion order)

New districts register in DISTRICTS below. See README.md for the module contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Sequence

# Relative import so `python3 scripts/gen_campus.py` resolves the package when
# scripts/ is on sys.path (gen_campus adds it before importing us).
from . import hostel_room3
from . import hq_hall
from . import hq_rooms456
from . import hostel_rooms12
from . import auditorium
from . import arcade_hall
from . import cafe
from . import coworking
from . import plaza_park

# Deterministic registration order. One entry per district module.
DISTRICTS: Sequence = (
    hostel_room3,
    hq_hall,
    hq_rooms456,
    hostel_rooms12,
    auditorium,
    arcade_hall,
    cafe,
    coworking,
    plaza_park,
)


@dataclass(frozen=True)
class DecorContext:
    """Read/write surface a district module is allowed to touch.

    Mutators only append furniture or repaint ground tiles. Query helpers are
    pure lookups against the already-authored frozen layers (walls, seats,
    doors, interactables, board seats) plus solid props already in `furniture`.
    """

    W: int
    H: int
    TS: int

    # LimeZu interior floor pattern blocks (3×2) + any other tile GIDs the
    # district needs for fill/fill_pattern. Plain ints / nested lists — same
    # objects gen_campus already built.
    FLOOR_CREAM: object
    FLOOR_PARQUET: object
    FLOOR_TEAL: object
    FLOOR_SLATE: object
    FLOOR_BRICK: object
    # Legacy indoor GIDs (useful as references; prefer FLOOR_* for restyles)
    FLOOR: int
    FLOOR_ACC: int
    FLOOR_HERR: int
    FLOOR_MOSS: int

    furn: Callable[[str, int, int, bool], None]
    fill: Callable[[int, int, int, int, int], None]
    fill_pattern: Callable[[int, int, int, int, object], None]

    is_wall: Callable[[int, int], bool]
    is_seat: Callable[[int, int], bool]
    is_door: Callable[[int, int], bool]
    is_interactable: Callable[[int, int], bool]
    is_board_seat: Callable[[int, int], bool]
    is_solid_prop: Callable[[int, int], bool]


def build_context(
    *,
    W: int,
    H: int,
    TS: int,
    ground: list,
    furniture: list,
    walls_data: list,
    seats_objs: list,
    door_zones: list,
    interactables_objs: list,
    board_seats: list,
    furn: Callable[[str, int, int, bool], None],
    fill_layer: Callable,
    fill_pattern_layer: Callable,
    floor_patterns: dict,
    floor_gids: dict,
) -> DecorContext:
    """Wire a DecorContext from gen_campus's live state.

    `fill_layer` / `fill_pattern_layer` are the script-level helpers that take a
    layer as their first arg; we bind them to `ground` so modules never see the
    layer list. `furn` is the script-level furniture appender (keeps id scheme).
    """

    def idx(x: int, y: int) -> int:
        return y * W + x

    def fill(x0: int, y0: int, x1: int, y1: int, tile: int) -> None:
        fill_layer(ground, x0, y0, x1, y1, tile)

    def fill_pattern(x0: int, y0: int, x1: int, y1: int, block: object) -> None:
        fill_pattern_layer(ground, x0, y0, x1, y1, block)

    def in_bounds(x: int, y: int) -> bool:
        return 0 <= x < W and 0 <= y < H

    def is_wall(x: int, y: int) -> bool:
        return in_bounds(x, y) and walls_data[idx(x, y)] != 0

    def _covers_tile(obj, tx: int, ty: int) -> bool:
        """True if object rect (or point-at-centre) covers tile (tx, ty)."""
        ox, oy = obj["x"], obj["y"]
        w = obj.get("width", 0) or 0
        h = obj.get("height", 0) or 0
        if obj.get("point") or (w == 0 and h == 0):
            # point → centre of its tile
            return (int(ox) // TS, int(oy) // TS) == (tx, ty)
        # inclusive tile coverage of the pixel rect
        x0 = int(ox) // TS
        y0 = int(oy) // TS
        x1 = (int(ox) + int(w) - 1) // TS
        y1 = (int(oy) + int(h) - 1) // TS
        return x0 <= tx <= x1 and y0 <= ty <= y1

    def is_seat(x: int, y: int) -> bool:
        return any(_covers_tile(o, x, y) for o in seats_objs)

    def is_door(x: int, y: int) -> bool:
        return any(_covers_tile(o, x, y) for o in door_zones)

    def is_interactable(x: int, y: int) -> bool:
        return any(_covers_tile(o, x, y) for o in interactables_objs)

    def is_board_seat(x: int, y: int) -> bool:
        return any(_covers_tile(o, x, y) for o in board_seats)

    def is_solid_prop(x: int, y: int) -> bool:
        for o in furniture:
            props = {p["name"]: p["value"] for p in o.get("properties", [])}
            if not props.get("solid"):
                continue
            # furniture points sit at tile centre
            if (int(o["x"]) // TS, int(o["y"]) // TS) == (x, y):
                return True
        return False

    return DecorContext(
        W=W,
        H=H,
        TS=TS,
        FLOOR_CREAM=floor_patterns["FLOOR_CREAM"],
        FLOOR_PARQUET=floor_patterns["FLOOR_PARQUET"],
        FLOOR_TEAL=floor_patterns["FLOOR_TEAL"],
        FLOOR_SLATE=floor_patterns["FLOOR_SLATE"],
        FLOOR_BRICK=floor_patterns["FLOOR_BRICK"],
        FLOOR=floor_gids["FLOOR"],
        FLOOR_ACC=floor_gids["FLOOR_ACC"],
        FLOOR_HERR=floor_gids["FLOOR_HERR"],
        FLOOR_MOSS=floor_gids["FLOOR_MOSS"],
        furn=furn,
        fill=fill,
        fill_pattern=fill_pattern,
        is_wall=is_wall,
        is_seat=is_seat,
        is_door=is_door,
        is_interactable=is_interactable,
        is_board_seat=is_board_seat,
        is_solid_prop=is_solid_prop,
    )


def apply_district_floors(ctx: DecorContext) -> None:
    """Run every district's floor pass (phase='floor'), registry order."""
    for mod in DISTRICTS:
        mod.decorate(ctx, phase="floor")


def apply_district_furniture(ctx: DecorContext) -> None:
    """Run every district's furniture pass (phase='furniture'), registry order."""
    for mod in DISTRICTS:
        mod.decorate(ctx, phase="furniture")
