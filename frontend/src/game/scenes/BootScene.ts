import Phaser from "phaser";
import { FRAME_W, FRAME_H } from "../avatar";

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

    // tilemap + tileset image
    this.load.tilemapTiledJSON("space", `${BASE}/maps/space.json`);
    this.load.image("floors_walls", `${BASE}/tilesets/floors_walls.png`);

    // character spritesheets
    for (let i = 1; i <= 4; i++) {
      this.load.spritesheet(`char${i}`, `${BASE}/characters/char${i}.png`, {
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
