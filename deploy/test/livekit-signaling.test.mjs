import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertLiveKitSignalingReady } from "./livekit-signaling.mjs";

const EXPECTED_IMAGE = "livekit/livekit-server:v1.9.12";

async function composeLiveKitImage(path) {
  const compose = await readFile(new URL(path, import.meta.url), "utf8");
  const match = compose.match(/^\s*image:\s*(livekit\/livekit-server:\S+)\s*$/m);
  assert.ok(match, `${path} must declare a pinned LiveKit image`);
  return match[1];
}

test("local and production Compose use the supported LiveKit image", async () => {
  const local = await composeLiveKitImage("../../docker-compose.yml");
  const production = await composeLiveKitImage("../docker-compose.prod.yml");
  assert.equal(local, EXPECTED_IMAGE);
  assert.equal(production, EXPECTED_IMAGE);
});

test("the supported signaling validation response is accepted", async () => {
  await assertLiveKitSignalingReady("http://livekit.test", {
    fetchImpl: async () => new Response("join_request is required\n", { status: 400 }),
  });
});

test("an incompatible server path fails readiness", async () => {
  await assert.rejects(
    assertLiveKitSignalingReady("http://livekit.test", {
      fetchImpl: async () => new Response("404 page not found\n", { status: 404 }),
    }),
    /LiveKit signaling is incompatible.*received 404/,
  );
});

test("startup transport failures are retried before signaling is ready", async () => {
  let fetchCalls = 0;
  const sleepDelays = [];

  await assertLiveKitSignalingReady("http://livekit.test", {
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) throw new TypeError("fetch failed");
      return new Response("join_request is required\n", { status: 400 });
    },
    attempts: 2,
    retryDelayMs: 25,
    sleepImpl: async (delayMs) => {
      sleepDelays.push(delayMs);
    },
  });

  assert.equal(fetchCalls, 2);
  assert.deepEqual(sleepDelays, [25]);
});
