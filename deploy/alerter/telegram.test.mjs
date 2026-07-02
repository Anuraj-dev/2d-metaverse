import { test } from "node:test";
import assert from "node:assert/strict";
import { sendTelegram, escapeHtml } from "./telegram.mjs";

function fetchStub(responses) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const next = responses.shift() ?? { ok: true };
    if (next.throw) throw new Error(next.throw);
    return {
      ok: next.ok,
      status: next.status ?? (next.ok ? 200 : 500),
      text: async () => next.text ?? "",
    };
  };
  return { impl, calls };
}

test("delivers on first attempt and returns true", async () => {
  const { impl, calls } = fetchStub([{ ok: true }]);
  assert.equal(await sendTelegram("tok", "42", "hello", impl), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.chat_id, "42");
  assert.equal(calls[0].body.parse_mode, "HTML");
});

test("non-2xx response is not treated as delivered; retried once then false", async () => {
  const { impl, calls } = fetchStub([
    { ok: false, status: 400, text: "Bad Request" },
    { ok: false, status: 400, text: "Bad Request" },
  ]);
  assert.equal(await sendTelegram("tok", "42", "hello", impl), false);
  assert.equal(calls.length, 2);
});

test("retry succeeds after a thrown network error", async () => {
  const { impl, calls } = fetchStub([{ throw: "ECONNRESET" }, { ok: true }]);
  assert.equal(await sendTelegram("tok", "42", "hello", impl), true);
  assert.equal(calls.length, 2);
});

test("never throws even when every attempt throws", async () => {
  const { impl } = fetchStub([{ throw: "boom" }, { throw: "boom" }]);
  assert.equal(await sendTelegram("tok", "42", "hello", impl), false);
});

test("missing token or chat id short-circuits to false without sending", async () => {
  const { impl, calls } = fetchStub([]);
  assert.equal(await sendTelegram("", "42", "hello", impl), false);
  assert.equal(await sendTelegram("tok", "", "hello", impl), false);
  assert.equal(calls.length, 0);
});

test("HTML metacharacters in the message are escaped", async () => {
  const { impl, calls } = fetchStub([{ ok: true }]);
  await sendTelegram("tok", "42", `<b>bold & "raw"</b>`, impl);
  assert.equal(calls[0].body.text, "&lt;b&gt;bold &amp; \"raw\"&lt;/b&gt;");
});

test("escapeHtml escapes ampersands before angle brackets", () => {
  assert.equal(escapeHtml("&lt;"), "&amp;lt;");
});

test("long messages are truncated to ~3500 chars", async () => {
  const { impl, calls } = fetchStub([{ ok: true }]);
  await sendTelegram("tok", "42", "x".repeat(5000), impl);
  assert.equal(calls[0].body.text.length, 3500);
});
