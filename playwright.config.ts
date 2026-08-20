import { defineConfig, devices } from "@playwright/test";

const visualPort = process.env.PLAYWRIGHT_PORT ?? "3000";
const visualBaseUrl = `http://127.0.0.1:${visualPort}`;

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
  webServer: {
    command: `npm run dev:client -- --host 127.0.0.1 --port ${visualPort}`,
    url: visualBaseUrl,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
