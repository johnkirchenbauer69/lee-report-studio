import { defineConfig, devices } from "@playwright/test";

/** Read-only frontend tests: every API call is intercepted; no backend process or CRM access. */
export default defineConfig({
  testDir: "./tests/visual",
  testMatch: "native-closing-pages.spec.ts",
  workers: 1,
  timeout: 60_000,
  outputDir: "test-results/native-closing",
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.LEE_QA_APP_URL ?? "http://127.0.0.1:3108",
  },
});
