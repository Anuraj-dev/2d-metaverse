#!/usr/bin/env python3
"""Cut the LimeZu "Modern Interiors" interior props into standalone furniture PNGs
(art proof-of-concept, hostel room 3).

Why cutouts and not a tileset: `WorldScene` furnishes the world from standalone
`f_<key>.png` sprites placed by the map's `furniture` object layer (depth-sorted,
solid ones get a collision body derived from the PNG's size). Cutting the props we
want out of the sheet reuses that whole pipeline instead of inventing a parallel
one. Floors and rugs stay TILES (`Room_Builder_free_16x16.png`, wired into
`gen_campus.py` as a third tileset) because a furniture sprite is depth-sorted by
its y and would draw over a player standing north of it.

Source (untracked, repo root): `Assets/New Assets/Modern_Interiors_Free_v2.2.zip`
  — LimeZu, Modern Interiors free tier. **Non-commercial licence** (see
  `Modern tiles_Free/LICENSE.txt` and the row in ATTRIBUTIONS.md). The sheets
  themselves are NOT committed; only the crops this script emits are.

Every crop names its source tile coordinates on the 16-col sheet, so the cut is
reproducible and reviewable without opening an image editor.

Writes: public/assets/furniture/lz_*.png
        public/assets/tilesets/room_builder.png
Run:    python3 scripts/gen_limezu_sprites.py
"""
import io
import os
import zipfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
ZIP = os.path.join(REPO, "Assets", "New Assets", "Modern_Interiors_Free_v2.2.zip")
FURN_OUT = os.path.join(HERE, "..", "public", "assets", "furniture")
TILE_OUT = os.path.join(HERE, "..", "public", "assets", "tilesets")

INTERIORS = "Modern tiles_Free/Interiors_free/16x16/Interiors_free_16x16.png"
ROOM_BUILDER = "Modern tiles_Free/Interiors_free/16x16/Room_Builder_free_16x16.png"

TS = 16

# key -> (source col, source row, width in tiles, height in tiles)
# Coordinates are 0-based on the 16-column `Interiors_free_16x16.png` sheet
# (256×1424 px = 16 × 89 tiles).
PROPS = {
    # -- soft seating / lounge -------------------------------------------------
    "lz_sofa":        (7, 13, 3, 2),   # 3-seat brown couch, front-facing
    "lz_side_table":  (6, 13, 1, 1),   # small round side table
    # -- storage / study -------------------------------------------------------
    "lz_bookshelf":   (5, 14, 2, 2),   # open shelf, books
    "lz_shelf_jars":  (5, 16, 2, 2),   # open shelf, jars + boxes
    "lz_sideboard":   (3, 59, 2, 2),   # low wooden sideboard
    # -- the meeting table: 1-tile-wide modules that butt up into a long run ----
    "lz_table":       (2, 36, 1, 2),   # plain desk module (top + front)
    "lz_table_books": (3, 36, 1, 2),   # same module, books on top
    "lz_table_cup":   (4, 36, 1, 2),   # same module, cup on top
    # -- kitchenette -----------------------------------------------------------
    "lz_counter":     (0, 57, 3, 2),   # counter run with an oven
    "lz_fridge":      (12, 40, 1, 2),  # fridge / cooler
    # -- wall dressing ---------------------------------------------------------
    "lz_board":       (0, 14, 2, 2),   # dark presentation board
    "lz_worldmap":    (10, 66, 2, 2),  # world map poster
    "lz_window":      (3, 13, 2, 2),   # window with a latch
    # -- greenery / light ------------------------------------------------------
    "lz_plant":       (10, 44, 2, 3),  # potted tree
    "lz_plant_small": (12, 45, 1, 2),  # small potted plant
    "lz_palm":        (13, 44, 2, 2),  # potted palm
    "lz_lamp":        (12, 53, 1, 3),  # standing floor lamp
}


def main():
    if not os.path.exists(ZIP):
        raise SystemExit(
            f"missing source pack: {ZIP}\n"
            "Download 'Modern Interiors (free)' from https://limezu.itch.io/moderninteriors "
            "and drop the zip at that path (it stays untracked)."
        )
    os.makedirs(FURN_OUT, exist_ok=True)
    os.makedirs(TILE_OUT, exist_ok=True)

    with zipfile.ZipFile(ZIP) as z:
        sheet = Image.open(io.BytesIO(z.read(INTERIORS))).convert("RGBA")
        rb = Image.open(io.BytesIO(z.read(ROOM_BUILDER))).convert("RGBA")

    # The room-builder sheet ships as-is: it is a tileset, wired into campus.json
    # by gen_campus.py (firstgid 2275) and preloaded via the maps.ts registry.
    rb_path = os.path.join(TILE_OUT, "room_builder.png")
    rb.save(rb_path)
    print(f"wrote {rb_path} ({rb.width}x{rb.height} = {rb.width // TS}x{rb.height // TS} tiles)")

    for key, (col, row, w, h) in sorted(PROPS.items()):
        box = (col * TS, row * TS, (col + w) * TS, (row + h) * TS)
        if box[2] > sheet.width or box[3] > sheet.height:
            raise SystemExit(f"{key}: crop {box} falls outside the sheet")
        crop = sheet.crop(box)
        if not crop.getbbox():
            raise SystemExit(f"{key}: crop at tile ({col},{row}) is fully transparent")
        # BootScene loads furniture/<name>.png under the texture key f_<name>,
        # so the file is named exactly as the map's `key` minus the f_ prefix.
        path = os.path.join(FURN_OUT, f"{key}.png")
        crop.save(path)
        print(f"wrote {path} ({crop.width}x{crop.height})")


if __name__ == "__main__":
    main()
