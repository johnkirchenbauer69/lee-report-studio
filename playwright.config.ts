import { defineConfig, devices } from "@playwright/test";
import { resolveVisualDataDir } from "./tests/support/visualDataDir";

const visualPort = process.env.PLAYWRIGHT_PORT ?? "3000";
const visualBaseUrl = `http://127.0.0.1:${visualPort}`;
const apiPort = process.env.PLAYWRIGHT_API_PORT ?? "8787";
// Mock LEE Intelligence MCP. Real MCP protocol, no network, no model call, so
// the narrative bridge round trip is exercised end to end in CI.
const mockMcpPort = process.env.PLAYWRIGHT_MOCK_MCP_PORT ?? "8790";
// Isolated, disposable per-run storage root — see tests/support/visualDataDir.ts.
// Never the normal `server/data` development/production store.
const { dir: visualDataDir } = resolveVisualDataDir();

export default defineConfig({
  testDir: "./tests/visual",
  testMatch: "**/*.spec.{ts,tsx}",
  // Verifies (via /api/health) that the API server backing this run is an
  // isolated test instance before any spec executes — see
  // tests/support/assertIsolatedTestServer.ts. Mutating specs like
  // zzz-phase1b-integrity.spec.ts must never be able to reach the normal
  // development template/report-instance store.
  globalSetup: "./tests/support/assertIsolatedTestServer.ts",
  // Removes the auto-generated temp data root after the run; an explicit
  // PLAYWRIGHT_DATA_DIR override is left alone for manual inspection.
  globalTeardown: "./tests/support/cleanupVisualDataDir.ts",
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
      command: `cross-env NODE_ENV=test MOCK_NARRATIVE_MCP_PORT=${mockMcpPort} tsx tests/support/startMockNarrativeMcp.ts`,
      url: `http://127.0.0.1:${mockMcpPort}/health`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `cross-env NODE_ENV=test REPORT_DATA_MODE=mock NARRATIVE_MODEL_PROVIDER=mock NARRATIVE_GENERATION_MODE=chatgpt_mcp NARRATIVE_MCP_URL=http://127.0.0.1:${mockMcpPort}/mcp NARRATIVE_MCP_CHATGPT_APP_URL=http://127.0.0.1:${mockMcpPort}/control/jobs NARRATIVE_MCP_POLL_MS=300 OPENAI_API_KEY= PORT=${apiPort} LEE_DATA_DIR=${visualDataDir} LEE_RENDER_APP_URL=${visualBaseUrl} npm run start`,
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
