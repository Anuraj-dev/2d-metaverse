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
import { worstOutcome, type MediaOutcome } from "./publicationState";

/**
 * A publisher's `setMic/CamEnabled` may be async (the LiveKit transport) or a
 * plain no-op mock (`() => void`). Await either and normalise a missing return
 * (mocks, mock-mode) to a successful outcome, so the aggregate never treats a
 * legacy void as a failure.
 */
async function resolveOutcome(
  result: MediaOutcome | undefined | Promise<MediaOutcome | undefined>,
  on: boolean,
): Promise<MediaOutcome> {
  const value = await result;
  return value ?? { status: on ? "live" : "off" };
}

/**
 * Record the desired mic state (optimistic — the control bar reverts on a failed
 * outcome) and fan it out to every active publisher, awaiting each so the bar can
 * surface the truthful bounded outcome (PRD 25.7). The worst outcome across
 * publishers wins (a denial anywhere beats a success elsewhere).
 */
export async function setMic(on: boolean): Promise<MediaOutcome> {
  setMediaPrefs({ micOn: on });
  if (USE_MOCK) {
    mockSetMic(on);
    return { status: on ? "live" : "off" };
  }
  return worstOutcome(
    await Promise.all([
      resolveOutcome(worldAudio.setMicEnabled(on), on),
      resolveOutcome(roomVideo.setMicEnabled(on), on),
      resolveOutcome(stageVideo.setMicEnabled(on), on),
    ]),
  );
}

export async function setCam(on: boolean): Promise<MediaOutcome> {
  setMediaPrefs({ camOn: on });
  if (USE_MOCK) {
    mockSetCam(on);
    return { status: on ? "live" : "off" };
  }
  // Proximity voice is audio-only; cameras publish to the room/meeting video and
  // the stage "Go Live" broadcast.
  return worstOutcome(
    await Promise.all([
      resolveOutcome(roomVideo.setCamEnabled(on), on),
      resolveOutcome(stageVideo.setCamEnabled(on), on),
    ]),
  );
}

/**
 * Screen share (PRD 23) rides the meeting room's LiveKit connection only — it is
 * not a global publisher fan-out like mic/cam (there is no world/stage screen
 * share), so it targets `roomVideo` alone and is meaningful only while seated in a
 * meeting. Sharing state is NOT sticky across surfaces: it is bound to the meeting
 * and torn down on leave. Mock mode has no LiveKit room, so it is a no-op.
 */
export function setScreenShare(on: boolean): void {
  if (USE_MOCK) return;
  void roomVideo.setScreenShareEnabled(on);
}

/** Current screen-share state (meeting room). */
export function isScreenSharing(): boolean {
  return roomVideo.isScreenSharing();
}

/** Subscribe to screen-share state changes (useSyncExternalStore-shaped). */
export function subscribeScreenShare(cb: () => void): () => void {
  return roomVideo.onScreenShareChanged(cb);
}

export function toggleMic(): Promise<MediaOutcome> {
  return setMic(!getMediaPrefs().micOn);
}

export function toggleCam(): Promise<MediaOutcome> {
  return setCam(!getMediaPrefs().camOn);
}
