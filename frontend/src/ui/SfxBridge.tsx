import { useEffect } from "react";
import { sharedNet } from "../net/shared";
import { bus } from "../game/eventBus";
import { playSfx, preloadSfx } from "../media/sfx";

/** Headless: plays gameplay sounds for presence + seating events. No UI. */
export default function SfxBridge() {
  useEffect(() => {
    preloadSfx();
    const net = sharedNet();
    const offJoin = net.on("player-joined", () => playSfx("join"));
    const offLeft = net.on("player-left", () => playSfx("leave"));
    const offSat = bus.on("sat", () => playSfx("sit"));
    return () => {
      offJoin();
      offLeft();
      offSat();
    };
  }, []);
  return null;
}
