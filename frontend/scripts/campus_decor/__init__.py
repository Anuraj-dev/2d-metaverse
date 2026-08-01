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
    """The whole surface a district module is allowed to touch.

    Deliberately tiny: append furniture, paint a ground pattern, and the four
    LimeZu floor blocks to paint with. Placement legality is not queryable here
    — it is checked centrally against the real rules in
    `frontend/src/game/maps.test.ts`, which is the only authority on it.
    """

    FLOOR_CREAM: object
    FLOOR_PARQUET: object
    FLOOR_TEAL: object
    FLOOR_SLATE: object

    furn: Callable[[str, int, int, bool], None]
    fill_pattern: Callable[[int, int, int, int, object], None]


def build_context(
    *,
    ground: list,
    furn: Callable[[str, int, int, bool], None],
    fill_pattern_layer: Callable,
    floor_patterns: dict,
) -> DecorContext:
    """Wire a DecorContext from gen_campus's live state.

    `fill_pattern_layer` is the script-level helper that takes a layer as its
    first arg; we bind it to `ground` so modules never see the layer list.
    `furn` is the script-level furniture appender (keeps the id scheme).
    """

    def fill_pattern(x0: int, y0: int, x1: int, y1: int, block: object) -> None:
        fill_pattern_layer(ground, x0, y0, x1, y1, block)

    return DecorContext(
        FLOOR_CREAM=floor_patterns["FLOOR_CREAM"],
        FLOOR_PARQUET=floor_patterns["FLOOR_PARQUET"],
        FLOOR_TEAL=floor_patterns["FLOOR_TEAL"],
        FLOOR_SLATE=floor_patterns["FLOOR_SLATE"],
        furn=furn,
        fill_pattern=fill_pattern,
    )


def apply_district_floors(ctx: DecorContext) -> None:
    """Run every district's floor pass (phase='floor'), registry order."""
    for mod in DISTRICTS:
        mod.decorate(ctx, phase="floor")


def apply_district_furniture(ctx: DecorContext) -> None:
    """Run every district's furniture pass (phase='furniture'), registry order."""
    for mod in DISTRICTS:
        mod.decorate(ctx, phase="furniture")
