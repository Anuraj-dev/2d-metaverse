/**
 * Privacy-conscious product-analytics client (PRD 25.26 slice; foundation from
 * the analytics-ingestion slice). Fire-and-forget POST of an allowlisted event
 * to the authenticated ingestion endpoint. The server owns identity and
 * timestamps; the client only sends an idempotency `eventId` + the bounded event.
 *
 * Telemetry must never break the game: every failure path is swallowed, mock and
 * misconfigured builds are no-ops, and the event shape is typed against the
 * shared `AnalyticsClientEvent` union so an unaudited event cannot be emitted.
 */
import type { AnalyticsClientEvent } from "@metaverse/shared";
import { USE_MOCK, authToken, serverBase } from "./net/auth";

function newEventId(): string {
  // crypto.randomUUID is available in every browser the pilot targets.
  return crypto.randomUUID();
}

/**
 * Emit one analytics event. No-op unless a real backend is configured and the
 * student is authenticated. Never throws, never blocks.
 */
export function emitAnalytics(event: AnalyticsClientEvent): void {
  try {
    if (USE_MOCK || !serverBase) return;
    const token = authToken();
    if (!token) return;
    void fetch(`${serverBase}/api/v1/analytics/events`, {
      method: "POST",
      keepalive: true,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ eventId: newEventId(), event }),
    }).catch(() => {
      /* telemetry failures are silent by design */
    });
  } catch {
    /* never let telemetry throw into the app */
  }
}
