import { describe, it, expect } from "vitest";
import type { PlayerState } from "@metaverse/shared";
import {
  CONNECTION_INITIAL,
  connectionReduce,
  isLive,
  reconcilePresence,
  type ConnectionEvent,
  type ConnectionStatus,
} from "./connectionState";

/** Replay a script of events from the initial state and return the final status. */
function run(events: ConnectionEvent[], start: ConnectionStatus = CONNECTION_INITIAL): ConnectionStatus {
  return events.reduce((status, event) => connectionReduce(status, event), start);
}

const p = (id: string, x = 0, y = 0): PlayerState => ({ id, name: id.toUpperCase(), x, y, dir: "down" });

describe("connectionReduce", () => {
  it("starts connecting and goes connected on a fresh (non-recovered) connect", () => {
    expect(CONNECTION_INITIAL).toBe("connecting");
    expect(run([{ type: "connect", recovered: false }])).toBe("connected");
  });

  it("settles to connected when init lands from connecting (mock/no socket lifecycle)", () => {
    expect(run([{ type: "init" }])).toBe("connected");
  });

  it("goes reconnecting on a transient disconnect and back to connected on plain reconnect", () => {
    expect(
      run([
        { type: "connect", recovered: false },
        { type: "disconnect", reason: "transport close" },
      ]),
    ).toBe("reconnecting");
    expect(
      run([
        { type: "connect", recovered: false },
        { type: "disconnect", reason: "ping timeout" },
        { type: "reconnecting" },
        { type: "connect", recovered: false },
      ]),
    ).toBe("connected");
  });

  it("enters recovered when the reconnect restored the session, then settles to connected", () => {
    const recovered = run([
      { type: "connect", recovered: false },
      { type: "disconnect", reason: "transport error" },
      { type: "reconnecting" },
      { type: "connect", recovered: true },
    ]);
    expect(recovered).toBe("recovered");
    // The authoritative re-emitted init is the reconciliation trigger — it does
    // NOT prematurely clear the "recovered" acknowledgement.
    expect(connectionReduce(recovered, { type: "init" })).toBe("recovered");
    // A timed settle (glue) is what returns the surface to plain connected.
    expect(connectionReduce(recovered, { type: "settle" })).toBe("connected");
  });

  it("goes gone on a terminal disconnect that will not auto-reconnect", () => {
    for (const reason of ["io server disconnect", "io client disconnect"] as const) {
      expect(
        run([
          { type: "connect", recovered: false },
          { type: "disconnect", reason },
        ]),
      ).toBe("gone");
    }
  });

  it("can recover from gone if the socket manually reconnects", () => {
    expect(run([{ type: "disconnect", reason: "io server disconnect" }, { type: "connect", recovered: false }])).toBe(
      "connected",
    );
    expect(run([{ type: "disconnect", reason: "io server disconnect" }, { type: "connect", recovered: true }])).toBe(
      "recovered",
    );
  });

  it("ignores settle unless currently recovered (no-op)", () => {
    for (const s of ["connecting", "connected", "reconnecting", "gone"] as const) {
      expect(connectionReduce(s, { type: "settle" })).toBe(s);
    }
  });

  it("a mid-flight reconnecting event forces the reconnecting surface", () => {
    expect(connectionReduce("connected", { type: "reconnecting" })).toBe("reconnecting");
    // but never resurrects a terminally-gone socket
    expect(connectionReduce("gone", { type: "reconnecting" })).toBe("gone");
  });
});

describe("isLive", () => {
  it("is true only when the client actually has an authoritative link", () => {
    expect(isLive("connected")).toBe(true);
    expect(isLive("recovered")).toBe(true);
    expect(isLive("connecting")).toBe(false);
    expect(isLive("reconnecting")).toBe(false);
    expect(isLive("gone")).toBe(false);
  });
});

describe("reconcilePresence", () => {
  it("adds remotes present in the snapshot but not yet tracked", () => {
    const diff = reconcilePresence([], [p("self"), p("a"), p("b")], "self");
    expect(diff.add.map((r) => r.id)).toEqual(["a", "b"]);
    expect(diff.remove).toEqual([]);
    expect(diff.update).toEqual([]);
  });

  it("removes tracked remotes absent from the snapshot (the stale-remote gap)", () => {
    const diff = reconcilePresence(["a", "b", "c"], [p("self"), p("a")], "self");
    expect(diff.remove.sort()).toEqual(["b", "c"]);
    expect(diff.add).toEqual([]);
    expect(diff.update.map((r) => r.id)).toEqual(["a"]);
  });

  it("classifies already-tracked remotes as updates carrying fresh positions", () => {
    const diff = reconcilePresence(["a"], [p("self"), p("a", 99, 42)], "self");
    expect(diff.update).toEqual([{ id: "a", name: "A", x: 99, y: 42, dir: "down" }]);
  });

  it("never treats self as a remote to add, remove, or update", () => {
    const diff = reconcilePresence(["a"], [p("self"), p("a")], "self");
    expect(diff.add).toEqual([]);
    expect(diff.remove).toEqual([]);
    expect(diff.update.map((r) => r.id)).toEqual(["a"]);
  });

  it("full convergence: simultaneous add, remove, and update in one snapshot", () => {
    const diff = reconcilePresence(["stale", "keep"], [p("self"), p("keep", 5, 5), p("fresh")], "self");
    expect(diff.add.map((r) => r.id)).toEqual(["fresh"]);
    expect(diff.remove).toEqual(["stale"]);
    expect(diff.update.map((r) => r.id)).toEqual(["keep"]);
  });
});
