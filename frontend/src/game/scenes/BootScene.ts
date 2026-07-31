import Phaser from "phaser";
import { FRAME_W, FRAME_H } from "../avatar";
import { CHARS } from "../chars";
import { activeMap } from "../maps";
import { CANVAS_FONT_FAMILY, CANVAS_FONT_PRIMARY } from "../uiFont";

const BASE = "/assets";

export default class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  preload() {
    const loadBar = this.add
      .text(this.scale.width / 2, this.scale.height / 2, "Loading…", {
        color: "#e6e9f0",
        fontFamily: CANVAS_FONT_FAMILY,
        fontSize: "16px",
      })
      .setOrigin(0.5);
    this.load.on("complete", () => loadBar.destroy());

    // active tilemap + its tileset image(s)
    const map = activeMap();
    this.load.tilemapTiledJSON(map.key, `${BASE}/maps/${map.key}.json`);
    for (const ts of map.tilesets) {
      this.load.image(ts.key, `${BASE}/tilesets/${ts.file}`);
    }

    // character spritesheets
    for (const c of CHARS) {
      this.load.spritesheet(c, `${BASE}/characters/${c}.png`, {
        frameWidth: FRAME_W,
        frameHeight: FRAME_H,
      });
    }

    // animated door sprite (32×48 per frame: closed / ajar / open frame —
    // composed by scripts/gen_door.py from the doors_windows tileset)
    this.load.spritesheet("door", `${BASE}/doors/door1.png`, {
      frameWidth: 32,
      frameHeight: 48,
    });

    // furniture (office interior)
    const furniture = [
      "chair", "chair_side", "chair_boss", "table_round", "table_small", "desk", "desk2",
      "desk_boss", "plant_big", "plant_small", "bookshelf", "bookshelf_tall",
      "sofa", "sofa_small", "water", "vending", "coffee", "clock",
      "arcade_snake", "arcade_flappy",
      // LimeZu interior props (scripts/gen_limezu_sprites.py). Catalog: docs/art/limezu-catalog.md
      "lz_ac", "lz_armchair", "lz_armchair_gray", "lz_armchair_side", "lz_armchair_white",
      "lz_art_flame", "lz_art_small", "lz_bar_stool", "lz_basket", "lz_basket_lid",
      "lz_bench_gold", "lz_bin", "lz_board", "lz_books", "lz_books2", "lz_bookshelf",
      "lz_bookshelf_tall", "lz_boxes", "lz_cabinet", "lz_cabinet_glass", "lz_cabinet_purple",
      "lz_chair", "lz_chair_side", "lz_chair_wood", "lz_chalkboard", "lz_chest",
      "lz_coffee_table", "lz_computer", "lz_console", "lz_counter", "lz_crate",
      "lz_desk_green", "lz_desk_hat", "lz_display_cab", "lz_drawer_row", "lz_filing",
      "lz_fireplace", "lz_floor_lamp", "lz_floor_lamp_blue", "lz_fridge", "lz_fruit_bowl",
      "lz_globe", "lz_kiosk", "lz_lamp", "lz_lectern", "lz_lockers", "lz_loveseat_purple",
      "lz_mini_fridge", "lz_mirror", "lz_mirror_floor", "lz_nightstand", "lz_ottoman",
      "lz_painting", "lz_painting2", "lz_palm", "lz_papers", "lz_pc_tower", "lz_pinboard",
      "lz_plant", "lz_plant_pot", "lz_plant_small", "lz_poster_grid", "lz_rug_beige",
      "lz_rug_blue", "lz_rug_green", "lz_rug_olive", "lz_rug_red", "lz_shelf_jars",
      "lz_shelf_white", "lz_shop_shelf", "lz_side_table", "lz_side_table_gold", "lz_sideboard",
      "lz_sofa", "lz_sofa_2seat", "lz_sofa_gray", "lz_sofa_purple", "lz_sofa_tan",
      "lz_sofa_white", "lz_stool", "lz_stool_wood", "lz_string_lights", "lz_table",
      "lz_table_books", "lz_table_cafe", "lz_table_cup", "lz_table_food", "lz_table_green",
      "lz_table_lamp", "lz_table_lamp_beige", "lz_table_study", "lz_tv", "lz_vanity",
      "lz_vending_shelf", "lz_wardrobe", "lz_wardrobe_glass", "lz_whiteboard", "lz_window",
      "lz_window_blinds", "lz_window_curtains", "lz_window_wood", "lz_worldmap",
    ];
    for (const f of furniture) this.load.image(`f_${f}`, `${BASE}/furniture/${f}.png`);
  }

  create() {
    // Wait for the self-hosted app webfont before starting the world, so
    // in-canvas text (nameplates, chat bubbles) is created on the real face
    // and never flashes the fallback font (Phaser rasterizes text at creation).
    const startWorld = () => this.scene.start("world");
    const fonts = document.fonts as FontFaceSet | undefined;
    if (fonts?.load) {
      void fonts
        .load(`16px "${CANVAS_FONT_PRIMARY}"`)
        .then(startWorld, startWorld);
    } else {
      startWorld();
    }
  }
}
