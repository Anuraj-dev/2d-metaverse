import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __APP_SHA__: JSON.stringify("test"),
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
