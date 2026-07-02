import { defineConfig } from "vitest/config";

// Framework-free schema/contract tests. No IO, no services — pure zod fixtures.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
