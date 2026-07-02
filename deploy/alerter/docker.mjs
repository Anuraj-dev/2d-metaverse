// Docker Engine API transport over the unix socket. Zero dependencies — just
// node:http talking to /var/run/docker.sock.
import http from "node:http";

const SOCKET_PATH = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";

function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCKET_PATH, path, method: "GET" }, (res) => {
      if (res.statusCode === undefined || res.statusCode < 200 || res.statusCode >= 300) {
        res.resume(); // drain so the socket is released
        reject(new Error(`Docker API ${path} returned status ${res.statusCode}`));
        return;
      }
      resolve(res);
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * Subscribe to container lifecycle events. Calls `onEvent(parsedEvent)` for
 * every JSON event line, and `onSubscribed()` once the Docker API has
 * accepted the subscription (2xx response). Reconnects are the caller's
 * responsibility (the returned promise rejects/resolves when the stream
 * ends).
 */
export function streamEvents(onEvent, onSubscribed) {
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
        if (res.statusCode === undefined || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`Docker API /events returned status ${res.statusCode}`));
          return;
        }
        onSubscribed?.();
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
//
// A valid header has stream byte 0 (stdin), 1 (stdout), or 2 (stderr) and
// three zero reserved bytes. A buffer is decoded as multiplexed ONLY when it
// parses as a complete sequence of well-formed frames end to end. Anything
// else — raw TTY logs, a malformed or incomplete header, a truncated
// payload — returns the whole original buffer as raw UTF-8: never partially
// decoded output, so diagnostic bytes are never dropped.
function looksLikeFrameHeader(buffer, offset) {
  return (
    offset + 8 <= buffer.length &&
    buffer[offset] <= 2 &&
    buffer[offset + 1] === 0 &&
    buffer[offset + 2] === 0 &&
    buffer[offset + 3] === 0
  );
}

export function demultiplex(buffer) {
  if (buffer.length === 0) return "";

  let offset = 0;
  const chunks = [];
  while (offset < buffer.length) {
    if (!looksLikeFrameHeader(buffer, offset)) {
      // Raw TTY output, malformed header, or incomplete trailing header.
      return buffer.toString("utf8");
    }
    const size = buffer.readUInt32BE(offset + 4);
    if (offset + 8 + size > buffer.length) {
      // Declared payload extends past the buffer — not a clean multiplex.
      return buffer.toString("utf8");
    }
    if (size > 0) chunks.push(buffer.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  return Buffer.concat(chunks).toString("utf8");
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
