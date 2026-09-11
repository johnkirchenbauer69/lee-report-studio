import path from "node:path";

/**
 * Playwright global setup. Runs after `webServer` readiness (Playwright
 * starts/reuses web servers before invoking globalSetup), before any spec.
 *
 * `playwright.config.ts` sets `reuseExistingServer: true` for fast local
 * iteration: if a server already answers `/api/health` on the configured
 * port, Playwright treats it as ready and never spawns its own isolated
 * instance. If that already-running process is a plain `npm run dev` /
 * `npm start` server (default `LEE_DATA_DIR=server/data`, no
 * `NODE_ENV=test`), every mutating request the visual suite makes —
 * including the Phase 1B/1C specs that create, publish, and delete
 * template versions and report instances through the real HTTP API —
 * lands in the normal development template/report-instance store instead
 * of the disposable one. That is how "Phase 1B ..." fixtures previously
 * persisted into the real Template Library.
 *
 * This check fails the whole run fast, before a single spec executes,
 * rather than relying on test cleanup after the fact.
 */
export default async function globalSetup(): Promise<void> {
  const apiPort = process.env.PLAYWRIGHT_API_PORT ?? "8787";
  const url = `http://127.0.0.1:${apiPort}/api/health`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    // Unreachable here means Playwright's own webServer step will report the
    // failure; do not mask it with an unrelated isolation error.
    return;
  }
  if (!response.ok) return;

  const body = (await response.json()) as {
    testMode?: boolean;
    dataRoot?: string;
  };
  const defaultDataRoot = path.resolve("server/data");
  const isolated = body.testMode === true && body.dataRoot !== defaultDataRoot;
  if (isolated) return;

  throw new Error(
    `Visual tests require an isolated API server, but the process answering ` +
      `${url} is not one (testMode=${body.testMode}, dataRoot=${body.dataRoot}). ` +
      `This usually means a plain "npm run dev" / "npm start" server is already ` +
      `running on port ${apiPort} and Playwright's reuseExistingServer attached ` +
      `to it instead of starting an isolated instance. Stop that server (or set ` +
      `PLAYWRIGHT_API_PORT to a free port) before running visual tests — ` +
      `otherwise mutating specs would write into the real development ` +
      `template/report-instance store.`,
  );
}
