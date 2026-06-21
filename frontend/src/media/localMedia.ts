/**
 * Local webcam/mic via getUserMedia — works standalone (no server) so the
 * bubble UI + mic/cam controls are demonstrable before LiveKit exists.
 * When Codex's LiveKit server is ready, media/livekit.ts will publish this
 * same stream as tracks; remote tracks replace the placeholder bubbles.
 */
let stream: MediaStream | null = null;
const listeners = new Set<(s: MediaStream | null) => void>();

export function onLocalStream(cb: (s: MediaStream | null) => void) {
  listeners.add(cb);
  cb(stream);
  return () => listeners.delete(cb);
}
function notify() {
  listeners.forEach((cb) => cb(stream));
}

export async function startCamera(video = true, audio = true) {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video, audio });
  } catch {
    stream = null; // permission denied or no device — bubbles fall back to avatar
  }
  notify();
  return stream;
}

export function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  notify();
}

export function setMicEnabled(on: boolean) {
  stream?.getAudioTracks().forEach((t) => (t.enabled = on));
}
export function setCamEnabled(on: boolean) {
  stream?.getVideoTracks().forEach((t) => (t.enabled = on));
}
export function getStream() {
  return stream;
}
