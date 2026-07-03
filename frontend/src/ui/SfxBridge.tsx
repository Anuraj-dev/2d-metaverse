import { useEffect } from "react";
import { sharedNet } from "../net/shared";
import { bus } from "../game/eventBus";
import {
  playSfx,
  playCue,
  preloadSfx,
  startLoops,
  stopLoops,
  setVoiceActive,
} from "../media/sfx";
import { EVENT_SOUNDS, anyVoiceActive, footstepDue, type StepState } from "../media/soundMixer";

/**
 * Headless: translates domain events into audio. Presence + seating + door +
 * portal + meeting one-shots come off the net/bus via the pure event→sound
 * table; footsteps ride the `positions` tick; the outdoor ambient bed ducks
 * against LiveKit voice levels. The music/ambient loops start on the first user
 * gesture (browser autoplay policy). No UI. All decision logic is in soundMixer.
 */
export default function SfxBridge() {
  useEffect(() => {
    preloadSfx();
    const net = sharedNet();
    const offs: Array<() => void> = [];

    // Presence chimes (net-level, not on the bus).
    offs.push(net.on("player-joined", () => playSfx("join")));
    offs.push(net.on("player-left", () => playSfx("leave")));

    // Event → sound, straight from the pure mapping table.
    for (const [event, cue] of Object.entries(EVENT_SOUNDS)) {
      offs.push(bus.on(event, () => playCue(cue.clip, cue.channel)));
    }

    // Footsteps: derive cadence from self-movement on the positions tick.
    let step: StepState = { lastStepAt: 0 };
    let last: { x: number; y: number } | null = null;
    offs.push(
      bus.on(
        "positions",
        (p: { players: { self: boolean; x: number; y: number }[] }) => {
          const me = p.players.find((pl) => pl.self);
          if (!me) return;
          const moving = last !== null && Math.hypot(me.x - last.x, me.y - last.y) > 1;
          last = { x: me.x, y: me.y };
          const r = footstepDue(step, performance.now(), moving);
          step = r.state;
          if (r.play) playCue("footstep", "sfx");
        }
      )
    );

    // Duck the ambient bed while any nearby peer is speaking.
    offs.push(
      bus.on("audio-volumes", (p: { volumes: Record<string, number> }) => {
        setVoiceActive(anyVoiceActive(p.volumes));
      })
    );

    // Autoplay unlock: loops may only start from a user gesture.
    const unlock = () => startLoops();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    return () => {
      offs.forEach((off) => off());
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      stopLoops();
    };
  }, []);
  return null;
}
