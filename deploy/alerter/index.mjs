// Watchdog entrypoint: subscribe to Docker container events, turn crashes /
// restart loops / unhealthy states into Telegram alerts with log excerpts.
import os from "node:os";
import fs from "node:fs";
import { decideAlert, LOG_PLACEHOLDER } from "./decide.mjs";
import { streamEvents, fetchLogs } from "./docker.mjs";
import { sendTelegram } from "./telegram.mjs";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
const HOSTNAME = os.hostname();

// Readiness marker consumed by the Dockerfile HEALTHCHECK. Touched ONLY once
// the alerter is genuinely operational: with a configured token that means
// the startup announcement was delivered AND the Docker events subscription
// is established; in no-token idle mode it means idle mode was entered.
const READY_FILE = process.env.ALERTER_READY_FILE ?? "/tmp/alerter-ready";

function markReady() {
  try {
    fs.writeFileSync(READY_FILE, `${Date.now()}\n`);
  } catch (error) {
    console.error("alerter: failed to write readiness file", error);
  }
}

// Mutable state threaded through the pure decision function.
let state = { restarts: {}, lastAlerted: {} };

async function handleEvent(event) {
  const result = decideAlert(event, { now: Date.now(), ...state });
  state = { restarts: result.restarts, lastAlerted: result.lastAlerted };
  if (!result.alert) return;

  const { title, body } = result.alert;
  const containerId = event?.Actor?.ID ?? event?.id;
  let logs = "(logs unavailable)";
  if (containerId) {
    try {
      const fetched = await fetchLogs(containerId, 50);
      if (fetched) logs = fetched;
    } catch (error) {
      console.error("alerter: failed to fetch logs", error);
    }
  }

  const text = `<b>${title}</b>\nHost: ${HOSTNAME}\n\n${body.replace(LOG_PLACEHOLDER, logs)}`;
  const delivered = await sendTelegram(TOKEN, CHAT_ID, text);
  console.log(`alerter: ${delivered ? "sent" : "failed to send"} alert — ${title}`);
}

async function main() {
  // A stale marker from a previous run must never satisfy the healthcheck.
  try {
    fs.unlinkSync(READY_FILE);
  } catch {
    /* absent is fine */
  }

  if (!TOKEN || !CHAT_ID) {
    console.log("alerter: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID unset — alerts disabled, idling.");
    // Idle forever rather than crash-looping so a missing token never breaks
    // the compose stack. Idle mode does not subscribe to events, so readiness
    // is marked on idle entry. The interval keeps the event loop alive (a
    // bare pending Promise holds no handle and Node would exit immediately).
    markReady();
    setInterval(() => {}, 2 ** 31 - 1);
    return;
  }

  const announced = await sendTelegram(TOKEN, CHAT_ID, `🟢 alerter online ${HOSTNAME}`);
  if (!announced) {
    // A configured token that cannot deliver means alerting is broken. Exit
    // non-zero so the compose restart policy retries and the deploy gate's
    // healthy-container check surfaces persistent failure loudly.
    console.error("alerter: startup announcement failed with a configured token — exiting");
    process.exit(1);
  }
  console.log(`alerter: online on ${HOSTNAME}, subscribing to Docker events`);

  // Reconnect loop: if the events stream ends or errors, wait and resubscribe.
  // Readiness is marked on the first accepted subscription — i.e. only after
  // BOTH the startup announcement and the events subscription succeeded.
  for (;;) {
    try {
      await streamEvents(
        (event) => {
          handleEvent(event).catch((error) => console.error("alerter: handler error", error));
        },
        markReady,
      );
      console.error("alerter: event stream ended, reconnecting in 2s");
    } catch (error) {
      console.error("alerter: event stream error, reconnecting in 2s", error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

main().catch((error) => {
  console.error("alerter: fatal", error);
  process.exit(1);
});
