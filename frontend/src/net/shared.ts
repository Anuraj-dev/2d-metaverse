import { createNet, type Net } from "./net";

/** One Net instance shared by the Phaser game and the React HUD. */
let instance: Net | null = null;
export function sharedNet(): Net {
  if (!instance) instance = createNet();
  return instance;
}
