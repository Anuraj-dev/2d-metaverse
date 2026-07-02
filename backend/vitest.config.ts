import { defineConfig } from "vitest/config";

// Unit suite: must pass with no Postgres/Redis running (CI's `test` job has no
// services). Integration files live under test/integration and are excluded.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**", "**/node_modules/**", "**/dist/**"]
  }
});
