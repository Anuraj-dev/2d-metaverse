import { defineConfig } from "vitest/config";

// Integration suite: REQUIRES Postgres + Redis (dev compose defaults; override
// DATABASE_URL / REDIS_URL). Files run sequentially — they share one database
// and one Redis logical DB, and each file flushes/cleans state as it starts.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.integration.test.ts"],
    setupFiles: ["test/integration/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});
