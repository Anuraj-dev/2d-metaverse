// Docker Engine API transport over the unix socket. Zero dependencies — just
// node:http talking to /var/run/docker.sock.
import http from "node:http";

const SOCKET_PATH = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";

function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCKET_PATH, path, method: "GET" }, resolve);
    req.on("error", reject);
    req.end();
  });
}

/**
 * Subscribe to container lifecycle events. Calls `onEvent(parsedEvent)` for
 * every JSON event line. Reconnects are the caller's responsibility (the
 * returned promise rejects/resolves when the stream ends).
 */
export function streamEvents(onEvent) {
  const filters = encodeURIComponent(
    JSON.stringify({
      type: ["container"],
      event: ["die", "restart", "health_status: unhealthy"],
    }),
  );
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: SOCKET_PATH, path: `/events?filters=${filters}`, method: "GET" },
      (res) => {
        let buffer = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buffer += chunk;
          let newline;
          while ((newline = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            try {
              onEvent(JSON.parse(line));
            } catch (error) {
              console.error("alerter: failed to parse event line", error);
            }
          }
        });
        res.on("end", resolve);
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// Docker multiplexes stdout/stderr in log streams with an 8-byte header per
// frame: [stream(1), 0, 0, 0, size(4, big-endian)]. Strip those frames.
function demultiplex(buffer) {
  let offset = 0;
  const chunks = [];
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset + 4);
    offset += 8;
    if (size === 0) continue;
    chunks.push(buffer.subarray(offset, offset + size));
    offset += size;
  }
  const out = Buffer.concat(chunks).toString("utf8");
  // If the stream was not multiplexed (no TTY-less header), fall back to raw.
  return out.length > 0 ? out : buffer.toString("utf8");
}

/** Fetch the last `tail` log lines of a container as a plain string. */
export function fetchLogs(containerId, tail = 50) {
  const path = `/containers/${encodeURIComponent(containerId)}/logs?tail=${tail}&stdout=1&stderr=1`;
  return new Promise((resolve, reject) => {
    request(path)
      .then((res) => {
        const parts = [];
        res.on("data", (chunk) => parts.push(chunk));
        res.on("end", () => {
          try {
            resolve(demultiplex(Buffer.concat(parts)).trim());
          } catch (error) {
            reject(error);
          }
        });
        res.on("error", reject);
      })
      .catch(reject);
  });
}
