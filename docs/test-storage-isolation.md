# Test storage isolation

## What happened

The normal Template Library accumulated entries such as "Phase 1B
asset-7ec45606" and "Phase 1B readonly-e06d6242" (versions 1.15.0–1.18.0 of
`industrial-market-report`), plus three matching report instances and one
`phase1b-shared-logo` asset, in the real development store
(`server/data/`, `LEE_DATA_DIR` default).

## Root cause

`tests/visual/zzz-phase1b-integrity.spec.ts` (Phase 1B immutability/asset
acceptance) drives the real HTTP API — `POST /api/templates/:id/versions/:v/new`,
`/publish`, `POST /api/report-instances`, `POST /api/assets` — to build
disposable fixtures per test run. Vitest-level repository tests
(`server/**/*.test.ts`) were never the issue: they already create a fresh
`mkdtemp(os.tmpdir())` directory per test and clean it up in `afterEach`.

The gap was one layer up. `playwright.config.ts` sets
`reuseExistingServer: true` on its `webServer` entries so iterative local
runs stay fast — if something already answers the configured URL, Playwright
treats it as ready and never spawns its own instance. A plain `npm run dev`
or `npm start` (default `LEE_DATA_DIR=server/data`, no `NODE_ENV`) left
running on port 8787 satisfies that check. When `npm run test:visual` (or a
single spec) runs afterward, Playwright silently attaches to that
already-running dev server instead of the isolated one its own `command`
would have started — and every mutating call the Phase 1B spec makes lands
in the real store.

That single mechanism explains every observed artifact:

- `zzz-phase1b-integrity.spec.ts`'s four sub-tests create/publish template
  versions named `Phase 1B ${token}` and, in two cases, generate a
  `ReportInstance` whose `sourceTemplateSnapshot.name` carries the same
  prefix (one test deliberately strips that snapshot to simulate a legacy
  report; it is identifiable only by its injected `legacy-<hex>-marker`
  text element).
- The "asset deletion" sub-test uploads `phase1b-shared-logo.png` and
  `phase1b-unused.png`; the test deletes the unused one itself (that is
  the assertion under test), leaving only the shared, still-referenced one.
- Because `FileSystemTemplateRepository.publish()` archives whatever
  version was previously published for that template id, the fixture
  publish (v1.17.0) archived the **real** v1.12.0 — the actual regression
  a developer would notice, since `getPublished("industrial-market-report")`
  (used by the wizard's "create a report without opening a template first"
  fallback, `App.tsx`'s `publishedTemplate`) then served test-fixture
  content instead of the real published template.

This is a local-dev-loop hazard only. GitHub Actions (`.github/workflows/quality.yml`)
always runs on a clean runner with nothing already bound to the target
ports, so `reuseExistingServer` never had anything stray to reuse there —
CI was never polluted.

## Fix

1. **`server/config/testStorageGuard.ts`** — `assertSafeDataRoot` is called
   once at server boot (`server/index.ts`). A process started with
   `NODE_ENV=test` that resolves to the default `server/data` root throws
   immediately instead of starting. This is the "fail fast" backstop, not
   the primary fix (see below) — it protects against a *test process*
   misconfigured to use the real store, not the reuse scenario.
2. **`/api/health`** now reports `dataRoot` and `testMode`.
3. **`tests/support/assertIsolatedTestServer.ts`** (Playwright `globalSetup`)
   is the fix for the actual reuse hazard: after `webServer` readiness
   (Playwright starts/reuses servers before running `globalSetup`), it
   fetches `/api/health` and aborts the entire run — before any spec, with
   an actionable message — unless the responding server reports
   `testMode: true` and a `dataRoot` other than the real default. A stray
   `npm run dev` left on port 8787 now fails the run loudly instead of
   silently absorbing test writes.
4. **`tests/support/visualDataDir.ts`** — the Playwright-managed API server's
   `LEE_DATA_DIR` now defaults to a unique `os.tmpdir()`-based directory per
   run (`<tmp>/lee-report-studio-tests/run-<pid>-<timestamp>/`) instead of
   the fixed, repeatedly-reused `tmp/playwright-data`. `PLAYWRIGHT_DATA_DIR`
   still overrides this for a developer who wants a stable, inspectable
   path across manual runs.
5. **`tests/support/cleanupVisualDataDir.ts`** (Playwright `globalTeardown`)
   removes the auto-generated directory after the run; an explicit
   `PLAYWRIGHT_DATA_DIR` override is left alone.
6. **`npm run dev` / `npm start` are unaffected** — `NODE_ENV` is not set to
   `test` for either, so `assertSafeDataRoot` is a no-op for normal
   development, and they keep using `server/data` as before.

Together, (3) is what actually closes the hole that produced this
pollution; (1)/(2) harden the boundary a script or CI change could
otherwise punch through again.

## Cleaning up the existing fixtures

`scripts/clean-test-fixture-pollution.ts` detects and removes the confirmed
test-owned records. It is a plain script, not wired into any startup path,
and defaults to a dry run:

```sh
npx tsx scripts/clean-test-fixture-pollution.ts               # logs exactly what would change
npx tsx scripts/clean-test-fixture-pollution.ts --apply       # backs up the affected files, then applies
npx tsx scripts/clean-test-fixture-pollution.ts --data-dir=... --apply   # target a different data root
```

Detection (`server/maintenance/testFixturePollution.ts`, unit-tested) is
deliberately narrow — the literal `Phase 1B ` template/report-snapshot name
prefix, the `phase1b-` asset name prefix, and the one legacy fixture's exact
injected marker element — rather than a broad heuristic like "template
version no longer exists." A report instance whose source template was
legitimately deleted by a human is a supported, real feature (see
`docs/report-instance-persistence.md`), not pollution, so "dangling
template reference" is never used as a deletion signal.

Before touching anything, the script cross-checks that no *surviving*
(non-test-owned) report instance or template still references a
fixture-owned template/asset; anything referenced is left in place and
reported under `blockedByRealReportReference` / `blockedByReference` for
manual review. On `--apply` it backs up `templates.json` and every removed
report instance file to `<dataRoot>/.cleanup-backups/<timestamp>/` before
writing anything.

Because `publish()` archives whichever version was previously published,
removing a published fixture would otherwise leave the template id with no
published version at all. The script walks back through the chain of
fixture publishes (a fixture can itself have archived an earlier fixture)
to the nearest surviving real version and restores its status to
`published` — undoing exactly the side effect the fixture publish caused,
without touching that version's content.

## What this does not do

- It does not delete anything automatically or at startup.
- It does not touch `industrial-market-report`'s real content at any
  version — only status/removal of the confirmed fixture rows and
  restoration of the one real version the fixture's `publish()` call
  archived.
- It does not change `getPublished`, `publish`, or any other
  report-generation binding; the wizard's `publishedTemplate` fallback
  starts resolving to the real template again purely because the
  fixture's published pointer is gone.
