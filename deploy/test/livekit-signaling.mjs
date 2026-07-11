import { pathToFileURL } from "node:url";

const SIGNALING_PATH = "/rtc/v1/validate";
const EXPECTED_STATUS = 400;
const EXPECTED_BODY = "join_request is required";

/**
 * Probe LiveKit's real signaling validation route rather than generic HTTP
 * liveness. LiveKit v1.9.1 returns 404 here; the supported v1.9.12 server
 * reaches the handler and rejects the intentionally-empty request with this
 * bounded 400 response.
 */
export async function assertLiveKitSignalingReady(
  baseUrl,
  { fetchImpl = fetch, timeoutMs = 5_000 } = {},
) {
  const url = new URL(SIGNALING_PATH, `${baseUrl.replace(/\/$/, "")}/`);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  const body = (await response.text()).trim();

  if (response.status !== EXPECTED_STATUS || body !== EXPECTED_BODY) {
    throw new Error(
      `LiveKit signaling is incompatible at ${url}: expected ${EXPECTED_STATUS} ${JSON.stringify(EXPECTED_BODY)}, received ${response.status} ${JSON.stringify(body.slice(0, 200))}`,
    );
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const baseUrl = process.argv[2] ?? process.env.LIVEKIT_SMOKE_URL ?? "http://localhost:7880";
  await assertLiveKitSignalingReady(baseUrl);
  console.log(`LiveKit signaling ready at ${baseUrl}${SIGNALING_PATH}`);
}
