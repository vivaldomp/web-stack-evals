import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.integration.test.ts", "tests/**/*.selftest.test.ts", "tests/**/*.live.test.ts"],
    testTimeout: 960000,
    hookTimeout: 960000,
  },
});
