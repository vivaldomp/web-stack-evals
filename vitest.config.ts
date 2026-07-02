import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: [
      ...configDefaults.exclude,
      "tests/**/*.integration.test.ts",
      "tests/**/*.selftest.test.ts",
      "tests/**/*.live.test.ts",
    ],
  },
});
