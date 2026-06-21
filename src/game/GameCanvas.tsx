import { useEffect, useRef } from "react";
import Phaser from "phaser";
import BootScene from "./scenes/BootScene";
import WorldScene from "./scenes/WorldScene";
import { sharedNet } from "../net/shared";

/** Mounts the Phaser game once and injects the Net implementation via the registry. */
export default function GameCanvas() {
  const parent = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (gameRef.current || !parent.current) return;
    const net = sharedNet();
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: parent.current,
      backgroundColor: "#1d2130",
      pixelArt: true,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: "100%",
        height: "100%",
      },
      physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 } } },
      scene: [BootScene, WorldScene],
    });
    game.registry.set("net", net);
    gameRef.current = game;

    return () => {
      net.disconnect();
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return <div ref={parent} className="game-canvas" />;
}
