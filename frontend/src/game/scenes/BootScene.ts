import Phaser from "phaser";
import { FRAME_W, FRAME_H } from "../avatar";
import { CHARS } from "../chars";
import { activeMap } from "../maps";

const BASE = "/assets";

export default class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  preload() {
    const loadBar = this.add
      .text(this.scale.width / 2, this.scale.height / 2, "Loading…", {
        color: "#e6e9f0",
        fontFamily: "monospace",
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

    // furniture (office interior)
    const furniture = [
      "chair", "chair_side", "chair_boss", "table_round", "table_small", "desk", "desk2",
      "desk_boss", "plant_big", "plant_small", "bookshelf", "bookshelf_tall",
      "sofa", "sofa_small", "water", "vending", "coffee", "clock",
    ];
    for (const f of furniture) this.load.image(`f_${f}`, `${BASE}/furniture/${f}.png`);
  }

  create() {
    this.scene.start("world");
  }
}
