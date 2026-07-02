/**
 * Pipoya 32x32 character helpers.
 * Sheet = 96x128 = 3 cols x 4 rows. Frame layout (row-major):
 *   down 0,1,2 | left 3,4,5 | right 6,7,8 | up 9,10,11
 * Middle frame of each row is the idle pose.
 */
import type Phaser from "phaser";
import type { Dir } from "@metaverse/shared";

export const FRAME_W = 32;
export const FRAME_H = 32;

const ROW: Record<Dir, number> = { down: 0, left: 1, right: 2, up: 3 };

export function idleFrame(dir: Dir): number {
  return ROW[dir] * 3 + 1;
}

/** Create walk animations for a loaded spritesheet texture key. */
export function createCharAnims(scene: Phaser.Scene, key: string) {
  (["down", "left", "right", "up"] as Dir[]).forEach((dir) => {
    const base = ROW[dir] * 3;
    const name = `${key}-walk-${dir}`;
    if (scene.anims.exists(name)) return;
    scene.anims.create({
      key: name,
      frames: scene.anims.generateFrameNumbers(key, {
        frames: [base, base + 1, base + 2, base + 1],
      }),
      frameRate: 8,
      repeat: -1,
    });
  });
}

export function walkAnim(key: string, dir: Dir): string {
  return `${key}-walk-${dir}`;
}
