import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Point the module at a throwaway unix socket before importing it.
const SOCKET = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "alerter-test-")), "docker.sock");
process.env.DOCKER_SOCKET = SOCKET;
const { demultiplex, fetchLogs } = await import("./docker.mjs");

function frame(stream, payload) {
  const body = Buffer.from(payload, "utf8");
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

test("demultiplex: single stdout frame", () => {
  assert.equal(demultiplex(frame(1, "hello\n")), "hello\n");
});

test("demultiplex: multiple frames across stdout and stderr", () => {
  const buf = Buffer.concat([frame(1, "out line\n"), frame(2, "err line\n"), frame(1, "more\n")]);
  assert.equal(demultiplex(buf), "out line\nerr line\nmore\n");
});

test("demultiplex: incomplete trailing payload falls back to the whole raw buffer", () => {
  const complete = frame(1, "complete\n");
  const partial = frame(2, "this payload is cut off").subarray(0, 12); // header + 4 bytes of 23
  const buf = Buffer.concat([complete, partial]);
  assert.equal(demultiplex(buf), buf.toString("utf8"));
});

test("demultiplex: incomplete trailing header falls back to the whole raw buffer", () => {
  const buf = Buffer.concat([frame(1, "done\n"), Buffer.from([1, 0, 0])]);
  assert.equal(demultiplex(buf), buf.toString("utf8"));
});

test("demultiplex: a partial first frame falls back to raw, never empty string", () => {
  const buf = frame(1, "payload that is cut").subarray(0, 10);
  const out = demultiplex(buf);
  assert.equal(out, buf.toString("utf8"));
  assert.notEqual(out, "");
});

test("demultiplex: raw TTY logs are returned unchanged", () => {
  const raw = Buffer.from("plain log line one\nplain log line two\n", "utf8");
  assert.equal(demultiplex(raw), raw.toString("utf8"));
});

test("demultiplex: malformed header mid-stream falls back to the raw buffer", () => {
  const good = frame(1, "ok\n");
  const malformed = Buffer.concat([Buffer.from([9, 9, 9, 9, 0, 0, 0, 4]), Buffer.from("junk")]);
  const buf = Buffer.concat([good, malformed]);
  assert.equal(demultiplex(buf), buf.toString("utf8"));
});

test("demultiplex: empty buffer yields empty string", () => {
  assert.equal(demultiplex(Buffer.alloc(0)), "");
});

test("demultiplex: zero-length frames are skipped", () => {
  const buf = Buffer.concat([frame(1, ""), frame(2, "after empty\n")]);
  assert.equal(demultiplex(buf), "after empty\n");
});

// --- Docker API status handling over a stub unix-socket server ---

const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/containers/missing/")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "No such container: missing" }));
    return;
  }
  res.writeHead(200, { "content-type": "application/octet-stream" });
  res.end(frame(1, "container says hi\n"));
});
await new Promise((resolve) => server.listen(SOCKET, resolve));
after(() => server.close());

test("fetchLogs rejects on a non-2xx Docker API response", async () => {
  await assert.rejects(fetchLogs("missing"), /status 404/);
});

test("fetchLogs demultiplexes a successful response", async () => {
  assert.equal(await fetchLogs("abc123"), "container says hi");
});
