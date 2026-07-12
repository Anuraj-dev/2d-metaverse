import { describe, expect, it } from "vitest";
import { loadPilotSchedule, nextScheduledActivity } from "../src/pilot-schedule.js";
import type { PilotScheduleEntry } from "@metaverse/shared";

const entry = (id: string, startsAt: string, endsAt: string): PilotScheduleEntry => ({
  id,
  title: `Session ${id}`,
  startsAt,
  endsAt,
  activityId: "room:commons",
});

describe("loadPilotSchedule", () => {
  it("validates the deployed configuration and returns an array", () => {
    // The deployed pilot config is empty at pilot start, but the source is valid.
    expect(loadPilotSchedule()).toEqual([]);
  });
});

describe("nextScheduledActivity", () => {
  const now = new Date("2026-07-11T12:00:00.000Z");

  it("returns null when nothing is current or upcoming", () => {
    const past = [entry("old", "2026-07-11T09:00:00.000Z", "2026-07-11T10:00:00.000Z")];
    expect(nextScheduledActivity(past, now)).toBeNull();
    expect(nextScheduledActivity([], now)).toBeNull();
  });

  it("prefers a session running right now over an upcoming one", () => {
    const schedule = [
      entry("upcoming", "2026-07-11T14:00:00.000Z", "2026-07-11T15:00:00.000Z"),
      entry("live", "2026-07-11T11:30:00.000Z", "2026-07-11T12:30:00.000Z"),
    ];
    expect(nextScheduledActivity(schedule, now)?.id).toBe("live");
  });

  it("returns the soonest upcoming session when none is live", () => {
    const schedule = [
      entry("later", "2026-07-11T16:00:00.000Z", "2026-07-11T17:00:00.000Z"),
      entry("sooner", "2026-07-11T13:00:00.000Z", "2026-07-11T14:00:00.000Z"),
    ];
    expect(nextScheduledActivity(schedule, now)?.id).toBe("sooner");
  });
});
