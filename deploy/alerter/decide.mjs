// Pure alert-decision logic. No IO here — everything the decision needs is
// passed in via `context`, and any state changes are returned rather than
// mutated in place, so this module is trivially testable.

export const DEFAULTS = {
  restartWindowMs: 5 * 60 * 1000, // 3+ restarts within this window is a loop
  restartThreshold: 3,
  dedupWindowMs: 10 * 60 * 1000, // don't re-alert the same container this often
};

// Marker that the transport layer replaces with a real log excerpt.
export const LOG_PLACEHOLDER = "%LOG_EXCERPT%";

function attribute(event, key) {
  return event?.Actor?.Attributes?.[key] ?? event?.actor?.attributes?.[key];
}

function containerName(event) {
  return attribute(event, "name") ?? "unknown";
}

function exitCodeOf(event) {
  const raw = attribute(event, "exitCode");
  if (raw === undefined || raw === null || raw === "") return null;
  const code = Number.parseInt(String(raw), 10);
  return Number.isNaN(code) ? null : code;
}

function buildBody(name, exitCode) {
  const codeText = exitCode === null ? "unknown" : String(exitCode);
  return `Container: ${name}\nExit code: ${codeText}\n\nRecent logs:\n${LOG_PLACEHOLDER}`;
}

/**
 * Decide whether a Docker container event warrants an alert.
 *
 * @param {object} event   Raw Docker event ({ status, Actor: { Attributes: { name, exitCode } } }).
 * @param {object} context { now, oneShot, restartWindowMs, restartThreshold,
 *                           dedupWindowMs, restarts: {name: number[]},
 *                           lastAlerted: {name: number} }
 * @returns {{ alert: null | {severity, title, body}, restarts: object, lastAlerted: object }}
 */
export function decideAlert(event, context = {}) {
  const cfg = { ...DEFAULTS, ...context };
  const now = context.now ?? Date.now();
  // Clone incoming state so callers' objects are never mutated.
  const restarts = { ...(context.restarts ?? {}) };
  const lastAlerted = { ...(context.lastAlerted ?? {}) };

  const status = event?.status;
  const name = containerName(event);
  const exitCode = exitCodeOf(event);

  let candidate = null;

  if (status === "die") {
    if (exitCode === 0) {
      // Clean exit — expected for one-shot containers (e.g. `setup`) and
      // harmless for others. A non-zero die below is always a real failure.
      return { alert: null, restarts, lastAlerted };
    }
    candidate = {
      severity: "critical",
      title: `🔴 ${name} exited ${exitCode === null ? "abnormally" : `(code ${exitCode})`}`,
      body: buildBody(name, exitCode),
    };
  } else if (status === "restart") {
    const window = (restarts[name] ?? []).filter((t) => now - t < cfg.restartWindowMs);
    window.push(now);
    restarts[name] = window;
    if (window.length >= cfg.restartThreshold) {
      candidate = {
        severity: "critical",
        title: `🔴 ${name} is in a restart loop (${window.length} restarts in ${Math.round(cfg.restartWindowMs / 60000)}m)`,
        body: buildBody(name, exitCode),
      };
    }
  } else if (status === "health_status: unhealthy") {
    candidate = {
      severity: "warning",
      title: `🟠 ${name} is unhealthy`,
      body: buildBody(name, exitCode),
    };
  }

  if (!candidate) {
    return { alert: null, restarts, lastAlerted };
  }

  // Dedup: suppress if we alerted on this container inside the dedup window.
  const previous = lastAlerted[name];
  if (previous !== undefined && now - previous < cfg.dedupWindowMs) {
    return { alert: null, restarts, lastAlerted };
  }

  lastAlerted[name] = now;
  return { alert: candidate, restarts, lastAlerted };
}
