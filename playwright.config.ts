import { defineConfig, devices } from "@playwright/test";

const visualPort = process.env.PLAYWRIGHT_PORT ?? "3000";
const visualBaseUrl = `http://127.0.0.1:${visualPort}`;
const apiPort = process.env.PLAYWRIGHT_API_PORT ?? "8787";

export default defineConfig({
  testDir: "./tests/visual",
  testMatch: "**/*.spec.{ts,tsx}",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "visual-report", open: "never" }],
  ],
  outputDir: "test-results/visual",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: visualBaseUrl,
    viewport: { width: 900, height: 1120 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "America/Chicago",
    colorScheme: "light",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `cross-env REPORT_DATA_MODE=mock NARRATIVE_MODEL_PROVIDER=mock PORT=${apiPort} LEE_DATA_DIR=tmp/playwright-data npm run dev:server`,
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `cross-env LEE_API_URL=http://127.0.0.1:${apiPort} npm run dev:client -- --host 127.0.0.1 --port ${visualPort}`,
      url: visualBaseUrl,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
