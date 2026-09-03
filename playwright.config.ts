import { defineConfig, devices } from "@playwright/test";

const visualPort = process.env.PLAYWRIGHT_PORT ?? "3000";
const visualBaseUrl = `http://127.0.0.1:${visualPort}`;
const apiPort = process.env.PLAYWRIGHT_API_PORT ?? "8787";
// Mock LEE Intelligence MCP. Real MCP protocol, no network, no model call, so
// the narrative bridge round trip is exercised end to end in CI.
const mockMcpPort = process.env.PLAYWRIGHT_MOCK_MCP_PORT ?? "8790";

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
      command: `cross-env MOCK_NARRATIVE_MCP_PORT=${mockMcpPort} tsx tests/support/startMockNarrativeMcp.ts`,
      url: `http://127.0.0.1:${mockMcpPort}/health`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `cross-env REPORT_DATA_MODE=mock NARRATIVE_MODEL_PROVIDER=mock NARRATIVE_GENERATION_MODE=chatgpt_mcp NARRATIVE_MCP_URL=http://127.0.0.1:${mockMcpPort}/mcp NARRATIVE_MCP_CHATGPT_APP_URL=http://127.0.0.1:${mockMcpPort}/control/jobs NARRATIVE_MCP_POLL_MS=300 OPENAI_API_KEY= PORT=${apiPort} LEE_DATA_DIR=tmp/playwright-data npm run start`,
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
