# `campus_decor` — district art-pass plug-ins

Parallel-safe seam for campus restyle work. `gen_campus.py` stays the structural
author (walls, rooms, seats, doors, interactables, legacy furniture). Each
**district art pass** lives in one small module here so eight agents can edit
eight files without colliding on the 900-line generator.

## Module contract

One district = one file = one module. Export a single entry point:

```python
def decorate(ctx, phase: str) -> None:
    """phase is 'floor' or 'furniture'."""
    ...
```

`ctx` is a `DecorContext` (see `__init__.py`). You get:

| API | Purpose |
|-----|---------|
| `ctx.furn(key, tx, ty, solid)` | Append a furniture object (same id scheme as gen_campus) |
| `ctx.fill(x0, y0, x1, y1, tile)` | Solid fill on the **ground** layer |
| `ctx.fill_pattern(x0, y0, x1, y1, block)` | Seamless 3×2 (or any) pattern fill on ground |
| `ctx.FLOOR_CREAM` / `ctx.FLOOR_PARQUET` / `ctx.FLOOR_TEAL` / `ctx.FLOOR_SLATE` | LimeZu interior pattern blocks |

**You may not** touch walls, seats, board_seats, doorZones, roomBounds,
interactables, stage, signs, or spawn. Those are frozen (see the restyle brief).

## Phases (why two)

`gen_campus` invokes the registry twice:

1. **`floor`** — right after `make_room` / structural floors, **before** the
   grass-variety RNG pass. Painting a tile that was still grass after that
   scatter consumes an extra `rng` draw and desyncs every later grass/flower
   tile (byte-identical regeneration depends on this order).
2. **`furniture`** — at the historical spot in the furniture bulk (ids are
   `20000 + len(furniture)` at insertion time). Moving a block later renumbers
   every subsequent prop.

Your module should branch on `phase` and do only that phase's work.

## Registry

Add your module to `DISTRICTS` in `__init__.py` (order = run order):

```python
from . import hostel_room3
from . import my_district

DISTRICTS = (
    hostel_room3,
    my_district,
)
```

## Worked example — hostel room 3

`hostel_room3.py` is the reference. Floor pass repaints interior + door
threshold with `FLOOR_CREAM` / parquet rug / teal bay; furniture pass hangs the
LimeZu lounge set around the frozen 12-seat table. Copy it, change the
coordinates and prop list, register the module.

```python
# my_district.py
def decorate(ctx, phase: str) -> None:
    if phase == "floor":
        ctx.fill_pattern(x0, y0, x1, y1, ctx.FLOOR_CREAM)
    elif phase == "furniture":
        ctx.furn("f_lz_plant", tx, ty, True)
```

## Placement rules

**Empty floor is not a defect.** This is a social space, not a showroom — open floor
is where players stand, walk and gather. A district that fills its floor becomes
unusable. Every prop must earn its place by being one of:

- **(a)** flush against a wall,
- **(b)** part of a cluster you can name in a comment (a desk pod, a snack counter,
  a table setting, a lounge),
- **(c)** a deliberate landmark at a path junction.

Anything else gets deleted. Three corollaries:

1. **Wall-hung sprites go only on the tile row against a wall** — never mid-floor,
   never outdoors. That is `f_lz_painting*`, `mirror*`, `board`, `chalkboard`,
   `whiteboard`, `pinboard`, `poster_grid`, `worldmap`, `window*`, `quilt*`,
   `shelf*`, `string_lights`, `ac`.
2. **Indoor furniture never goes outdoors.** The outdoor vocabulary is benches,
   trees/palms, a few planters, bins, the occasional lamp post, and notice boards
   against a structure. Nothing else.
3. **No single sprite key more than ~6 times per district**, except purpose-built
   seating rows. Needing 20 of something to fill a space means the space did not
   need filling.

Aisles, room centres, door spines and the auditorium **presenter zone** carry no
props at all.

## Rules

- **One district owns exactly one file.** Do not edit another district's module
  or `gen_campus.py` (except the agent that owns the seam).
- No new props in the seam itself — only migrate / add inside your district file.
- Prefer a flat list of `ctx.furn(...)` calls over helpers or DSLs.
- Keep accent floor zones small (`FLOOR_PARQUET` etc. are rugs, not wall-to-wall).
- Walkable lanes must stay **≥ 2 tiles** (player body is 18px; tiles are 16px).
- Solid furniture lines the walls; clutter can be non-solid in open floor.
- Comments describe the space as it is — never a changelog of what was moved or cut.
- Never run `git` from a district agent; never run npm/vitest/tsc.
