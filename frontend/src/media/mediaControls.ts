/**
 * Side-effect shell for the global control bar's mic/cam toggles (PRD 20). It records
 * the desired state in the leaf `mediaPrefs` module and fans it out to every active
 * publisher: proximity voice (`worldAudio`) while walking, and the room/meeting video
 * (`roomVideo`) while seated. Each transport guards its own null room, so applying to
 * an inactive one is a safe no-op, and `livekit` re-reads the prefs when a room
 * becomes active — so a single mute follows the player across walk<->meeting rather
 * than resetting on every transition (the pre-overhaul bug). Mock mode (no backend)
 * toggles the local getUserMedia stream instead.
 */
import { worldAudio, roomVideo } from "./livekit";
import { setCamEnabled as mockSetCam, setMicEnabled as mockSetMic } from "./localMedia";
import { USE_MOCK } from "../net/auth";
import { getMediaPrefs, setMediaPrefs } from "./mediaPrefs";

export function setMic(on: boolean): void {
  setMediaPrefs({ micOn: on });
  if (USE_MOCK) {
    mockSetMic(on);
    return;
  }
  worldAudio.setMicEnabled(on);
  roomVideo.setMicEnabled(on);
}

export function setCam(on: boolean): void {
  setMediaPrefs({ camOn: on });
  if (USE_MOCK) {
    mockSetCam(on);
    return;
  }
  // Only the room/meeting video publishes a camera; proximity voice is audio-only.
  roomVideo.setCamEnabled(on);
}

export function toggleMic(): boolean {
  const on = !getMediaPrefs().micOn;
  setMic(on);
  return on;
}

export function toggleCam(): boolean {
  const on = !getMediaPrefs().camOn;
  setCam(on);
  return on;
}
