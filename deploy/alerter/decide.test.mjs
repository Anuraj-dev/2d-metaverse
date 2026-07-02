import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAlert, DEFAULTS, LOG_PLACEHOLDER } from "./decide.mjs";

const T0 = 1_000_000_000_000;

function dieEvent(name, exitCode) {
  return {
    status: "die",
    Type: "container",
    Actor: { Attributes: { name, exitCode: String(exitCode) } },
  };
}

function restartEvent(name) {
  return { status: "restart", Type: "container", Actor: { Attributes: { name } } };
}

function unhealthyEvent(name) {
  return {
    status: "health_status: unhealthy",
    Type: "container",
    Actor: { Attributes: { name } },
  };
}

test("clean exit (code 0) is ignored", () => {
  const { alert } = decideAlert(dieEvent("setup", 0), { now: T0 });
  assert.equal(alert, null);
});

test("non-zero die produces a critical alert with name and exit code", () => {
  const { alert, lastAlerted } = decideAlert(dieEvent("backend", 137), { now: T0 });
  assert.ok(alert);
  assert.equal(alert.severity, "critical");
  assert.match(alert.body, /Container: backend/);
  assert.match(alert.body, /Exit code: 137/);
  assert.match(alert.body, new RegExp(LOG_PLACEHOLDER.replace(/[%]/g, "\\%")));
  assert.equal(lastAlerted.backend, T0);
});

test("die with missing exit code still alerts (code unknown)", () => {
  const event = { status: "die", Actor: { Attributes: { name: "backend" } } };
  const { alert } = decideAlert(event, { now: T0 });
  assert.ok(alert);
  assert.equal(alert.severity, "critical");
  assert.match(alert.body, /Exit code: unknown/);
});

test("dedup: same container is not re-alerted within the 10-minute window", () => {
  const first = decideAlert(dieEvent("backend", 1), { now: T0 });
  assert.ok(first.alert);

  // 5 minutes later — inside the dedup window — should be suppressed.
  const second = decideAlert(dieEvent("backend", 1), {
    now: T0 + 5 * 60 * 1000,
    lastAlerted: first.lastAlerted,
  });
  assert.equal(second.alert, null);
  // lastAlerted must not advance while suppressed.
  assert.equal(second.lastAlerted.backend, T0);

  // Past the window it alerts again and lastAlerted advances.
  const later = T0 + DEFAULTS.dedupWindowMs + 1;
  const third = decideAlert(dieEvent("backend", 1), {
    now: later,
    lastAlerted: second.lastAlerted,
  });
  assert.ok(third.alert);
  assert.equal(third.lastAlerted.backend, later);
});

test("restart loop: 3 restarts within 5 minutes triggers a critical alert", () => {
  let state = { restarts: {}, lastAlerted: {} };

  const r1 = decideAlert(restartEvent("backend"), { now: T0, ...state });
  assert.equal(r1.alert, null);
  state = r1;

  const r2 = decideAlert(restartEvent("backend"), { now: T0 + 60_000, ...state });
  assert.equal(r2.alert, null);
  state = r2;

  const r3 = decideAlert(restartEvent("backend"), { now: T0 + 120_000, ...state });
  assert.ok(r3.alert);
  assert.equal(r3.alert.severity, "critical");
  assert.match(r3.alert.title, /restart loop/);
});

test("restart loop: restarts spread beyond the window do not trip the alert", () => {
  let state = { restarts: {}, lastAlerted: {} };
  // Three restarts, each 4 minutes apart — never 3 inside a 5-minute window.
  for (const offset of [0, 4 * 60_000, 8 * 60_000]) {
    const res = decideAlert(restartEvent("backend"), { now: T0 + offset, ...state });
    assert.equal(res.alert, null);
    state = res;
  }
});

test("unhealthy health status produces a warning", () => {
  const { alert } = decideAlert(unhealthyEvent("livekit"), { now: T0 });
  assert.ok(alert);
  assert.equal(alert.severity, "warning");
  assert.match(alert.title, /unhealthy/);
  assert.match(alert.body, /Container: livekit/);
});

test("decideAlert does not mutate the incoming state maps", () => {
  const restarts = {};
  const lastAlerted = {};
  decideAlert(dieEvent("backend", 1), { now: T0, restarts, lastAlerted });
  assert.deepEqual(restarts, {});
  assert.deepEqual(lastAlerted, {});
});

test("unknown event statuses yield no alert", () => {
  const { alert } = decideAlert({ status: "start", Actor: { Attributes: { name: "backend" } } }, { now: T0 });
  assert.equal(alert, null);
});
