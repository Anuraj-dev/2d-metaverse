/**
 * Pure media-publication state (PRD 25.7).
 *
 * The old media layer conflated five separate concerns into one boolean: the
 * player's *desired* preference (mediaPrefs), device *permission*, device
 * *availability*, the transport *connection*, and whether a track is actually
 * *published*. Toggles fired and forgot; failures were swallowed to
 * `console.warn`, so the UI could show LIVE / unmuted while nothing was on the
 * wire. This module models the confirmed publication lifecycle as an explicit,
 * truthful state machine — plain values in / plain values out, no LiveKit / DOM
 * imports — mirroring `game/connectionState.ts`. The transport (`livekit.ts`)
 * stops swallowing outcomes and feeds this reducer real events; the HUD renders
 * the reduced status and never invents it.
 *
 * The invariant that matters for the stage (criterion: "Stage cannot show LIVE
 * after failed publication"): `"live"` is reachable ONLY through the publish
 * pipeline (`enable → connecting → publishing → published`). A `failed`/`denied`/
 * `unavailable` outcome leaves a resting failure state that a stray `published`
 * signal cannot resurrect — a fresh `enable` must restart the pipeline first.
 */

/**
 * The distinct, user-truthful publication states. Each corresponds to a state
 * the player can actually be in; they never overlap.
 *  - `off`          — desired off / muted; nothing published (the resting state).
 *  - `pending`      — the player asked to publish; the transport hasn't acted yet.
 *  - `connecting`   — the transport is (re)negotiating the room connection.
 *  - `publishing`   — connected; the capture/publish call is in flight.
 *  - `live`         — a track is confirmed published (the ONLY "on air" truth).
 *  - `reconnecting` — an established publish dropped and the transport is retrying.
 *  - `denied`       — capture was refused (browser permission / security block).
 *  - `unavailable`  — no capture device is present.
 *  - `failed`       — the publish attempt failed for any other reason.
 */
export type MediaPublicationStatus =
  | "off"
  | "pending"
  | "connecting"
  | "publishing"
  | "live"
  | "reconnecting"
  | "denied"
  | "unavailable"
  | "failed";

export const INITIAL_PUBLICATION: MediaPublicationStatus = "off";

/** Why a publish attempt could not produce a live track (a bounded outcome). */
export type MediaFailure = "denied" | "unavailable" | "failed";

export type MediaPublicationEvent =
  | { type: "enable" }
  | { type: "disable" }
  | { type: "connecting" }
  | { type: "publishing" }
  | { type: "published" }
  | { type: "reconnecting" }
  | { type: "failed"; reason: MediaFailure }
  | { type: "ended" };

/** Resting (non-in-flight) states an `enable` may restart the pipeline from. */
const RESTING: ReadonlySet<MediaPublicationStatus> = new Set<MediaPublicationStatus>([
  "off",
  "denied",
  "unavailable",
  "failed",
]);

/** In-flight/established states from which a `published` confirmation is valid. */
const PUBLISH_PIPELINE: ReadonlySet<MediaPublicationStatus> = new Set<MediaPublicationStatus>([
  "pending",
  "connecting",
  "publishing",
  "reconnecting",
  "live",
]);

/**
 * Fold one transport/intent event onto the current status. Illegal transitions
 * are no-ops (return the current status unchanged) so a stray or late signal can
 * never move the machine into a dishonest state — the reason the stage cannot
 * flip to LIVE off a resting failure.
 */
export function publicationReduce(
  status: MediaPublicationStatus,
  event: MediaPublicationEvent,
): MediaPublicationStatus {
  switch (event.type) {
    case "enable":
      // Arm the pipeline only from a resting state; an already-active publish is
      // left as-is (a redundant enable must not bounce it back to pending).
      return RESTING.has(status) ? "pending" : status;
    case "disable":
    case "ended":
      // The player turned it off (or the room tore down cleanly): always off.
      return "off";
    case "connecting":
      // A truthful transport signal — but never resurrect a device the player
      // just turned off; only advance the pipeline, not a resting `off`.
      return status === "off" ? "off" : "connecting";
    case "publishing":
      return status === "off" ? "off" : "publishing";
    case "published":
      // The load-bearing guard: confirmation is honoured ONLY while the publish
      // pipeline is live. From a resting failure/off it is ignored.
      return PUBLISH_PIPELINE.has(status) ? "live" : status;
    case "reconnecting":
      // Only an established/attempting publish can be "reconnecting"; a resting
      // state stays put.
      return PUBLISH_PIPELINE.has(status) ? "reconnecting" : status;
    case "failed":
      return event.reason;
  }
}

/**
 * The single truth gate for "show LIVE / ON AIR". Only a confirmed-published
 * track counts — pending/connecting/publishing/failed never read as live.
 */
export function isPublished(status: MediaPublicationStatus): boolean {
  return status === "live";
}

/** A publish attempt is still resolving (the UI may show a spinner/pending). */
export function isPublishPending(status: MediaPublicationStatus): boolean {
  return status === "pending" || status === "connecting" || status === "publishing";
}

/** The publish could not be established and needs the player's attention. */
export function isPublishFailure(status: MediaPublicationStatus): boolean {
  return status === "denied" || status === "unavailable" || status === "failed";
}

/* ------------------------------ Toggle outcomes ---------------------------- */
/**
 * The bounded result the transport reports back from a single toggle op, so the
 * control bar can await it and surface truth instead of an optimistic guess.
 *  - `live`/`off`   — the device reached the requested published/muted state.
 *  - `denied`/`unavailable`/`failed` — a bounded failure (see `MediaFailure`).
 *  - `inactive`     — there was no active transport for this publisher, so the
 *                     toggle was a no-op (e.g. muting the stage while not on air).
 */
export type MediaOutcomeStatus = "live" | "off" | MediaFailure | "inactive";

export interface MediaOutcome {
  readonly status: MediaOutcomeStatus;
}

/** Higher = more important to surface when aggregating across publishers. */
const OUTCOME_SEVERITY: Record<MediaOutcomeStatus, number> = {
  denied: 5,
  unavailable: 4,
  failed: 3,
  live: 2,
  off: 1,
  inactive: 0,
};

/**
 * Reduce several publishers' outcomes to the single one worth surfacing: a real
 * failure wins over a success, and any concrete state wins over `inactive`. An
 * empty set (no publishers ran) is treated as `inactive`.
 */
export function worstOutcome(outcomes: readonly MediaOutcome[]): MediaOutcome {
  let worst: MediaOutcome = { status: "inactive" };
  for (const o of outcomes) {
    if (OUTCOME_SEVERITY[o.status] > OUTCOME_SEVERITY[worst.status]) worst = o;
  }
  return worst;
}

/** Whether a toggle outcome should revert the optimistic preference + warn. */
export function outcomeNeedsAttention(status: MediaOutcomeStatus): status is MediaFailure {
  return status === "denied" || status === "unavailable" || status === "failed";
}

/**
 * Classify a caught capture/publish error into a bounded failure, from the
 * `DOMException.name` the browsers raise for getUserMedia/publish. Anything
 * unrecognised is a generic `failed` — never thrown onward, so telemetry/UX
 * degrade rather than break.
 */
export function classifyMediaError(err: unknown): MediaFailure {
  const name = errorName(err);
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "unavailable";
    default:
      return "failed";
  }
}

function errorName(err: unknown): string | undefined {
  if (err instanceof Error) return err.name;
  if (typeof err === "object" && err !== null && "name" in err) {
    const name = (err as { name: unknown }).name;
    if (typeof name === "string") return name;
  }
  return undefined;
}
