import path from "node:path";

/**
 * Phase 1B/1C fixtures (Playwright specs such as
 * `tests/visual/zzz-phase1b-integrity.spec.ts`) create, publish, and delete
 * template versions and report instances through the real HTTP API. That is
 * only safe when the server they are calling is backed by an isolated,
 * disposable data root.
 *
 * The isolation hole this guards against: `playwright.config.ts` sets
 * `reuseExistingServer: true` so iterative local runs stay fast. If a plain
 * `npm run dev` / `npm start` process (default `LEE_DATA_DIR=server/data`,
 * no `NODE_ENV=test`) is already listening on the configured port when
 * Playwright starts, Playwright treats it as ready and never spawns its own
 * isolated instance — every mutating request from the test suite then lands
 * in the real development template/report-instance store. That is exactly
 * how "Phase 1B ..." fixtures previously persisted into the normal Template
 * Library.
 *
 * `assertSafeDataRoot` makes that failure mode fail fast at server boot
 * instead of relying on test cleanup: a process started with
 * `NODE_ENV=test` must be pointed at a data root other than the default
 * development store.
 */

export function resolveDefaultDataRoot(): string {
  return path.resolve("server/data");
}

export interface DataRootSafetyInput {
  nodeEnv: string | undefined;
  dataRoot: string;
  defaultDataRoot?: string;
}

export class UnsafeTestDataRootError extends Error {
  constructor(dataRoot: string) {
    super(
      `Refusing to start with NODE_ENV=test against "${dataRoot}". Automated ` +
        "tests must never share storage with normal development/production " +
        "data. Set LEE_DATA_DIR to an isolated, disposable directory (a " +
        "unique os.tmpdir()-based path per run is preferred) before starting " +
        "this process in test mode.",
    );
    this.name = "UnsafeTestDataRootError";
  }
}

/**
 * Throws when a process claiming to be a test run (`NODE_ENV=test`) resolves
 * to the same data root normal development/production uses. Safe to call
 * unconditionally at boot; it is a no-op outside test mode.
 */
export function assertSafeDataRoot({
  nodeEnv,
  dataRoot,
  defaultDataRoot = resolveDefaultDataRoot(),
}: DataRootSafetyInput): void {
  if (nodeEnv !== "test") return;
  const resolved = path.resolve(dataRoot);
  if (resolved === defaultDataRoot) throw new UnsafeTestDataRootError(resolved);
}
