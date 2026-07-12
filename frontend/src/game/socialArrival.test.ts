import { describe, expect, it } from "vitest";
import { socialArrivalView, type SocialArrivalInput } from "./socialArrival";
import type { PresenceSnapshot } from "@metaverse/shared";

const snapshot = (over: Partial<PresenceSnapshot> = {}): PresenceSnapshot => ({
  spaceId: "1",
  people: [{ id: "self", name: "me", activity: "world", place: null }],
  activeSpaces: [],
  nextScheduled: null,
  ...over,
});

const input = (over: Partial<SocialArrivalInput>): SocialArrivalInput => ({
  status: "ready",
  snapshot: snapshot(),
  selfId: "self",
  ...over,
});

describe("socialArrivalView — distinct arrival states", () => {
  it("reports loading before a snapshot and while connecting", () => {
    expect(socialArrivalView(input({ status: "ready", snapshot: null })).kind).toBe("loading");
    expect(socialArrivalView(input({ status: "loading" })).kind).toBe("loading");
  });

  it("reports offline and failed distinctly from loading", () => {
    expect(socialArrivalView(input({ status: "offline" })).kind).toBe("offline");
    expect(socialArrivalView(input({ status: "failed" })).kind).toBe("failed");
  });

  it("reports empty when only the viewer is online and nothing is active", () => {
    expect(socialArrivalView(input({})).kind).toBe("empty");
  });

  it("stays empty even if offline/failed status is ignored only when ready", () => {
    // A ready snapshot with just the viewer and no schedule is empty, not active.
    const view = socialArrivalView(input({ snapshot: snapshot({ nextScheduled: null }) }));
    expect(view.kind).toBe("empty");
  });
});

describe("socialArrivalView — active view", () => {
  it("excludes the viewer from others and surfaces spaces + schedule + count", () => {
    const view = socialArrivalView(
      input({
        snapshot: snapshot({
          people: [
            { id: "self", name: "me", activity: "world", place: null },
            { id: "b", name: "bob", activity: "meeting", place: "Commons" },
          ],
          activeSpaces: [{ kind: "meeting", id: "r1", label: "Commons", count: 1 }],
          nextScheduled: {
            id: "welcome",
            title: "Welcome mixer",
            startsAt: "2026-07-11T17:00:00.000Z",
            endsAt: "2026-07-11T18:00:00.000Z",
            activityId: "room:commons",
          },
        }),
      }),
    );
    expect(view.kind).toBe("active");
    if (view.kind !== "active") throw new Error("expected active");
    expect(view.others.map((p) => p.id)).toEqual(["b"]);
    expect(view.onlineCount).toBe(2);
    expect(view.spaces).toHaveLength(1);
    expect(view.nextScheduled?.id).toBe("welcome");
  });

  it("is active when a scheduled activity exists even with no one else online", () => {
    const view = socialArrivalView(
      input({
        snapshot: snapshot({
          nextScheduled: {
            id: "later",
            title: "Study jam",
            startsAt: "2026-07-11T20:00:00.000Z",
            endsAt: "2026-07-11T21:00:00.000Z",
            activityId: "room:library",
          },
        }),
      }),
    );
    expect(view.kind).toBe("active");
  });
});
