/**
 * Side-effect shell for the global control bar's mic/cam toggles (PRD 20). It records
 * the desired state in the leaf `mediaPrefs` module and fans it out to every active
 * publisher: proximity voice (`worldAudio`) while walking, the room/meeting video
 * (`roomVideo`) while seated, and the stage broadcast (`stageVideo`) while on air /
 * live (PRD 17). Each transport guards its own inactive state, so applying to an
 * inactive one is a safe no-op, and `livekit` re-reads the prefs when a room
 * becomes active — so a single mute follows the player across walk<->meeting<->stage
 * rather than resetting on every transition (the pre-overhaul bug). Mock mode (no
 * backend) toggles the local getUserMedia stream instead.
 */
import { worldAudio, roomVideo, stageVideo } from "./livekit";
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
  stageVideo.setMicEnabled(on);
}

export function setCam(on: boolean): void {
  setMediaPrefs({ camOn: on });
  if (USE_MOCK) {
    mockSetCam(on);
    return;
  }
  // Proximity voice is audio-only; cameras publish to the room/meeting video and
  // the stage "Go Live" broadcast.
  roomVideo.setCamEnabled(on);
  stageVideo.setCamEnabled(on);
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
