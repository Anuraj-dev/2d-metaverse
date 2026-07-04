import { useEffect } from "react";
import { sharedNet } from "../net/shared";
import { bus } from "../game/eventBus";
import {
  playSfx,
  playCue,
  preloadSfx,
  startLoops,
  stopLoops,
  setMeetingActive,
  setOutdoors,
  setVoiceActive,
} from "../media/sfx";
import { EVENT_SOUNDS, footstepDue, speechActive, type StepState } from "../media/soundMixer";
import { speakingState } from "../media/speakingState";
import { OUTDOOR_ZONE } from "../game/audioZones";

/**
 * Headless: translates domain events into audio. Presence + seating + door +
 * portal + meeting one-shots come off the net/bus via the pure event→sound
 * table; footsteps ride the `positions` tick; the music + ambient loops duck
 * whenever an audible peer (or the local player) is actually speaking — the
 * speech state comes off the LiveKit active-speaker seam (`speakingState`) gated
 * by the per-peer proximity volumes (`audio-volumes`). The loops start on the
 * first user gesture (browser autoplay policy). No UI. All decision logic is in
 * soundMixer.
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

    // Speech-driven duck inputs: the active-speaker set (who is talking), the
    // per-peer proximity volumes (who is audible), and the local player id (to
    // tell self-speech from peer-speech). Any change re-evaluates the pure
    // `speechActive` decision and updates the loop duck.
    let speaking: ReadonlySet<string> = new Set();
    let volumes: Record<string, number> = {};
    let selfId = "";
    const recomputeDuck = () => setVoiceActive(speechActive(speaking, volumes, selfId));

    // Footsteps ride the positions tick; the same tick carries the local
    // player's audio zone, which gates the outdoor ambience (no birdsong
    // inside a room — rooms are aurally private in both directions), and the
    // local player id used by the speech-duck decision.
    let step: StepState = { lastStepAt: 0 };
    let last: { x: number; y: number } | null = null;
    offs.push(
      bus.on(
        "positions",
        (p: { players: { id: string; self: boolean; x: number; y: number; zone: string }[] }) => {
          const me = p.players.find((pl) => pl.self);
          if (!me) return;
          if (me.id !== selfId) {
            selfId = me.id;
            recomputeDuck();
          }
          setOutdoors(me.zone === OUTDOOR_ZONE);
          const moving = last !== null && Math.hypot(me.x - last.x, me.y - last.y) > 1;
          last = { x: me.x, y: me.y };
          const r = footstepDue(step, performance.now(), moving);
          step = r.state;
          if (r.play) playCue("footstep", "sfx");
        }
      )
    );

    // Meeting lifecycle: the world loops fade out from portal-in and fade back
    // in on portal-out (the WorldScene sleeps in between — the loops must not
    // keep playing over the meeting grid).
    offs.push(bus.on("portal-enter", () => setMeetingActive(true)));
    offs.push(bus.on("portal-exit", () => setMeetingActive(false)));

    // Speech-driven duck: recompute when the audible set (proximity volumes) or
    // the active-speaker set changes. A peer must be both audible AND speaking —
    // or the local player speaking — to duck the world loops.
    offs.push(
      bus.on("audio-volumes", (p: { volumes: Record<string, number> }) => {
        volumes = p.volumes;
        recomputeDuck();
      })
    );
    offs.push(
      speakingState.subscribe((s) => {
        speaking = s;
        recomputeDuck();
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
