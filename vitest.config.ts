import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "server/**/*.test.ts"],
    exclude: ["tests/visual/**", "node_modules/**", "dist/**"],
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: process.env.CI
      ? { junit: "test-results/vitest.xml" }
      : undefined,
  },
});
