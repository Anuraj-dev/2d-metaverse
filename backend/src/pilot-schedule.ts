/**
 * The validated pilot community schedule (PRD 25.26).
 *
 * This is a *versioned, schema-validated repository configuration deployed with
 * the backend* — deliberately code, not a live events platform or database table.
 * Operators add/update sessions by editing `PILOT_SCHEDULE` in a reviewed PR.
 *
 * `loadPilotSchedule` validates the configuration against the shared schema and
 * fails safe: invalid configuration degrades to an empty schedule (logged) rather
 * than crashing arrival. `nextScheduledActivity` is a pure selector picking the
 * currently-running or soonest-upcoming session, so the arrival surface can point
 * students at "the next scheduled community activity".
 */
import { pilotScheduleSchema, type PilotSchedule, type PilotScheduleEntry } from "@metaverse/shared";
import { childLogger } from "./logger.js";
import type { Logger } from "pino";

const log = childLogger({ module: "pilot-schedule" });

/**
 * Pilot session list. Empty at pilot start — no sessions are scheduled yet, but
 * the validated source exists so operators can add entries through a config PR.
 * Each entry: { id, title, startsAt (UTC ISO), endsAt (UTC ISO), activityId,
 * description? }. See `pilotScheduleEntrySchema` for the bounds.
 */
const PILOT_SCHEDULE: readonly unknown[] = [];

/**
 * Validate the deployed configuration, dropping already-finished sessions.
 * Returns [] (and logs) on any validation failure so arrival never breaks.
 */
export function loadPilotSchedule(now: Date = new Date(), logger: Logger = log): PilotSchedule {
  const parsed = pilotScheduleSchema.safeParse(PILOT_SCHEDULE);
  if (!parsed.success) {
    logger.error({ err: parsed.error }, "invalid pilot schedule configuration; serving empty schedule");
    return [];
  }
  const cutoff = now.getTime();
  return parsed.data.filter((entry) => Date.parse(entry.endsAt) > cutoff);
}

/**
 * Pick the single "next" community activity from a validated schedule: a session
 * running right now takes priority (earliest start), otherwise the soonest one to
 * start. Returns null when nothing is current or upcoming.
 */
export function nextScheduledActivity(
  schedule: readonly PilotScheduleEntry[],
  now: Date = new Date(),
): PilotScheduleEntry | null {
  const at = now.getTime();
  const live = schedule
    .filter((entry) => Date.parse(entry.startsAt) <= at && Date.parse(entry.endsAt) > at)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  if (live[0]) return live[0];

  const upcoming = schedule
    .filter((entry) => Date.parse(entry.startsAt) > at)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return upcoming[0] ?? null;
}
