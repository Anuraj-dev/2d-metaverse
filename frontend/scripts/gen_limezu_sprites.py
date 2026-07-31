#!/usr/bin/env python3
"""Cut the LimeZu "Modern Interiors" interior props into standalone furniture PNGs.

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

Catalog of every key: `docs/art/limezu-catalog.md`

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
    "lz_sofa":            (7, 13, 3, 2),   # 3-seat brown couch, front-facing
    "lz_sofa_gray":       (1, 72, 3, 2),   # modern gray 3-seat
    "lz_sofa_white":      (4, 72, 3, 2),   # modern white/silver 3-seat
    "lz_sofa_tan":        (7, 72, 3, 2),   # modern tan 3-seat
    "lz_sofa_2seat":      (7, 74, 2, 2),   # white modern 2-seat
    "lz_sofa_purple":     (7, 46, 3, 2),   # purple gold-trim 3-seat
    "lz_loveseat_purple": (5, 46, 2, 2),   # purple gold-trim 2-seat
    "lz_armchair":        (4, 21, 1, 2),   # wood lounge armchair front
    "lz_armchair_side":   (7, 21, 1, 2),   # wood lounge chair side profile
    "lz_armchair_gray":   (1, 74, 2, 2),   # modern gray armchair
    "lz_armchair_white":  (4, 74, 2, 2),   # modern white armchair
    "lz_ottoman":         (3, 74, 1, 2),   # gray modern ottoman
    "lz_bench_gold":      (2, 44, 2, 2),   # purple/gold bench with back
    "lz_side_table":      (6, 13, 1, 1),   # small round side table
    "lz_side_table_gold": (4, 44, 1, 2),   # purple gold side table
    "lz_coffee_table":    (2, 47, 2, 1),   # purple gold low coffee table
    "lz_console":         (7, 51, 2, 1),   # low wood console / coffee table

    # -- chairs ----------------------------------------------------------------
    "lz_chair":           (2, 38, 1, 2),   # school/office chair front
    "lz_chair_side":      (9, 33, 1, 2),   # wood chair side profile
    "lz_chair_wood":      (12, 33, 1, 2),  # reddish wood chair side
    "lz_stool":           (1, 38, 1, 2),   # low stool, green legs
    "lz_stool_wood":      (12, 62, 1, 2),  # wood cafe stool
    "lz_bar_stool":       (11, 53, 1, 2),  # red mushroom bar stool
    # legacy name kept for room-3 maps — this crop is a blue bar stool, not a lamp
    "lz_lamp":            (12, 53, 1, 3),  # blue bar stool with tripod base

    # -- desks & office --------------------------------------------------------
    "lz_table":           (2, 36, 1, 2),   # plain desk module (top + front)
    "lz_table_books":     (3, 36, 1, 2),   # desk module, papers on top
    "lz_table_cup":       (4, 36, 1, 2),   # desk module, cup + pen
    "lz_desk_hat":        (1, 36, 1, 2),   # desk module with hat/papers
    "lz_desk_green":      (8, 36, 1, 2),   # green-top desk, side view
    "lz_table_green":     (11, 38, 2, 2),  # green desk, front view
    "lz_table_study":     (7, 40, 2, 2),   # study table with open book
    "lz_lectern":         (5, 36, 2, 2),   # wide table + open book (podium-ish)
    "lz_computer":        (3, 8, 1, 2),    # monitor on desk unit
    "lz_pc_tower":        (4, 8, 1, 2),    # white PC tower / mini rack
    "lz_filing":          (2, 16, 2, 2),   # white filing drawer bank
    "lz_pinboard":        (0, 41, 2, 1),   # cork pinboard with notes
    "lz_board":           (0, 14, 2, 2),   # dark presentation board
    "lz_chalkboard":      (13, 40, 2, 2),  # wall chalkboard with tray
    "lz_whiteboard":      (10, 40, 2, 2),  # freestanding board on legs
    "lz_globe":           (13, 36, 1, 2),  # desk globe, gold stand
    "lz_poster_grid":     (13, 38, 2, 2),  # colorful grid notice board
    "lz_ac":              (0, 8, 3, 2),    # wall air-conditioner unit

    # -- storage & wall --------------------------------------------------------
    "lz_bookshelf":       (5, 14, 2, 2),   # open shelf, books
    "lz_shelf_jars":      (5, 16, 2, 2),   # open shelf, jars + boxes
    "lz_bookshelf_tall":  (6, 18, 2, 2),   # white open shelf, books + clutter
    "lz_shelf_white":     (2, 18, 2, 2),   # white bookshelf with books
    "lz_lockers":         (2, 21, 2, 2),   # wood cubby/locker unit (one door open)
    "lz_wardrobe":        (7, 48, 2, 3),   # tall wood wardrobe, double doors
    "lz_wardrobe_glass":  (9, 49, 2, 2),   # wardrobe with glass panels
    "lz_cabinet":         (0, 61, 2, 3),   # tall ornate wood cabinet
    "lz_cabinet_glass":   (5, 61, 2, 3),   # wood cabinet, glass doors + clutter
    "lz_cabinet_purple":  (0, 45, 2, 2),   # purple gold-trim cabinet
    "lz_sideboard":       (3, 59, 2, 2),   # low wooden sideboard
    "lz_vanity":          (2, 48, 2, 3),   # dressing table with mirror
    "lz_nightstand":      (12, 11, 1, 1),  # small 2-drawer nightstand
    "lz_crate":           (8, 57, 2, 1),   # closed wooden crate
    "lz_boxes":           (8, 58, 2, 1),   # open cardboard boxes
    "lz_chest":           (12, 79, 2, 1),  # storage chest (top view)
    "lz_worldmap":        (10, 66, 2, 2),  # world map poster
    "lz_window":          (3, 13, 2, 2),   # window with latch
    "lz_window_curtains": (4, 24, 3, 2),   # window with beige curtains
    "lz_window_wood":     (7, 24, 2, 2),   # wood-frame 4-pane window
    "lz_window_blinds":   (0, 28, 2, 2),   # window with horizontal blinds
    "lz_mirror":          (3, 66, 1, 2),   # wall mirror, wood frame
    "lz_mirror_floor":    (9, 69, 1, 3),   # freestanding floor mirror
    "lz_painting":        (0, 24, 2, 2),   # framed seascape
    "lz_painting2":       (2, 24, 2, 2),   # framed people/portrait
    "lz_tv":              (0, 20, 2, 2),   # wall TV (red scene on screen)
    "lz_art_small":       (0, 72, 1, 1),   # small landscape frame
    "lz_art_flame":       (0, 74, 1, 1),   # small flame/torch art

    # -- kitchen / cafe --------------------------------------------------------
    "lz_counter":         (0, 57, 3, 2),   # counter run with oven window
    "lz_fridge":          (12, 40, 1, 2),  # tall blue cooler / fridge
    "lz_mini_fridge":     (14, 60, 1, 2),  # small red appliance (oven-like window)
    "lz_kiosk":           (14, 62, 2, 2),  # small market stall / service window
    "lz_display_cab":     (12, 60, 2, 2),  # glass display cabinet
    "lz_drawer_row":      (3, 56, 2, 1),   # low wood drawer run
    "lz_fruit_bowl":      (0, 53, 1, 2),   # fruit bowl on stand
    "lz_table_food":      (3, 54, 2, 1),   # tabletop with cake/dessert
    "lz_table_cafe":      (5, 54, 2, 1),   # tabletop with lamp + books
    "lz_shop_shelf":      (10, 68, 2, 3),  # stocked shop/grocery shelf
    "lz_vending_shelf":   (10, 72, 2, 2),  # short stocked shelf
    "lz_basket":          (0, 66, 1, 2),   # woven basket
    "lz_basket_lid":      (1, 68, 1, 2),   # lidded green basket

    # -- greenery, lamps, clutter ----------------------------------------------
    "lz_plant":           (10, 44, 2, 3),  # potted leafy tree
    "lz_plant_small":     (12, 45, 1, 2),  # small potted plant
    "lz_palm":            (13, 44, 2, 2),  # potted palm (top of 3-row plant)
    "lz_plant_pot":       (0, 48, 1, 2),   # small plant in yellow pot
    "lz_floor_lamp":      (12, 56, 1, 3),  # beige standing floor lamp
    "lz_floor_lamp_blue": (13, 56, 1, 3),  # blue-shade floor lamp, tripod
    "lz_table_lamp":      (14, 56, 1, 2),  # blue table lamp
    "lz_table_lamp_beige":(15, 56, 1, 2),  # beige/wood table lamp
    "lz_string_lights":   (10, 47, 2, 1),  # string of fairy lights
    "lz_books":           (9, 31, 1, 1),   # book stack
    "lz_books2":          (11, 31, 1, 1),  # alternate book stack
    "lz_papers":          (13, 28, 2, 2),  # messy papers + books pile
    "lz_bin":             (7, 56, 1, 2),   # crumpled paper bag (soft bin)
    "lz_rug_red":         (7, 16, 4, 2),   # large red/gold border rug
    "lz_rug_beige":       (0, 42, 3, 2),   # beige geometric rug
    "lz_rug_green":       (11, 18, 2, 2),  # small green rug
    "lz_rug_blue":        (13, 20, 2, 2),  # small blue rug
    "lz_rug_olive":       (10, 28, 2, 2),  # olive square rug

    # -- auditorium / stage-adjacent -------------------------------------------
    "lz_fireplace":       (4, 68, 2, 3),   # brick fireplace with fire
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

    print(f"\n{len(PROPS)} props total")


if __name__ == "__main__":
    main()
