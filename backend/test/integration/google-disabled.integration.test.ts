import { afterAll, beforeAll, expect, it } from "vitest";
import { api, startServer, teardown, type TestServer } from "./helpers.js";
let server: TestServer;
beforeAll(async () => { server = await startServer(); });
afterAll(async () => { await teardown(server); });
it("advertises Google as disabled and refuses all sign-in routes without credentials", async () => {
  expect(await api(server.baseUrl, "/api/v1/auth/providers")).toEqual({ status: 200, json: { google: false } });
  for (const path of ["start", "callback", "exchange"]) {
    expect(await api(server.baseUrl, `/api/v1/auth/google/${path}`, path === "exchange" ? { body: {} } : {}))
      .toEqual({ status: 503, json: { error: "oauth-disabled" } });
  }
});
