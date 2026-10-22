# Canonical report release validation

## Architecture and preservation

GitHub `johnkirchenbauer69/lee-report-studio` is the authoritative source repository. The application runs on the local Windows installation. There is no Render deployment or hosted application. Playwright tests the local application. InDesign 2026 Desktop runs only after an operator export action; unattended Adobe API/Server execution is unavailable and is not a release requirement.

The approved Q3 publication and existing reports remain pinned. New Classic and Geographic editions have independent identities; the editable closing-page update is a new version, never a rewrite of a published master or saved report. Shared assets are captured by checksum. No Salesforce records are modified by these tests.

## Implemented behavior

Both canonical families generate 44 pages from all 18 submarkets. Geographic requires a saved activity map and explicit featured-listing selection decision for each submarket. A qualifying Lee listing is selected only for the matching period and submarket; an explicit empty result never borrows another market's listing. Links are omitted without a verified source URL.

The template selector shows the two approved design previews and defaults to all 18 detailed submarkets. Version 1.1 adds structured, editable closing-page bodies while retaining the edition's header, footer address, logos, and bindings. Nested company logo/map assets and semantic closing-page fonts are captured for offline reproduction. New editions store display-safe asset names before hashing, so the API's display sanitizer cannot invalidate their template checksums. Asset identities, storage paths, and bytes remain unchanged.

One-click Desktop export freezes a saved report revision, prepares linked vector charts/maps and photos, activates an available InDesign session, assembles native text/tables, and packages only a validated result. INDD, native PDF, frozen report data, manifests, artwork, and permitted fonts are included. IDML is deliberately omitted pending actual import validation. The workstation lock and immutable claims prevent automatic replay after uncertain execution. See `server/indesign/LOCAL-WORKER.md`.

## Visual comparison findings

The earlier PDFs were generated from different fixtures: the narrative-layout baseline used historical narratives/manual overrides, while the later live-generation fixture used blank narratives and current property captions. Those content differences are not renderer regressions.

Exact replay of the earlier frozen print jobs produced identical text, content streams, image inventory, and font inventory on all 88 pages. Twelve representative pages per family were pixel-identical at 150 DPI in both MuPDF and PDFium. The inspected set covers the cover, overall-market tables, charts, submarket pages/maps, photographs, and closing pages. This distinguishes underlying artwork equality from a renderer-specific screenshot result.

The guarded shadow-mask normalization remains enabled. It repairs supported luminosity-to-alpha masks without reverting the mobile transparency correction. Unsupported mask structures fail the guard instead of being silently changed. New editable closing pages are a deliberate artwork change and receive separate readable-resolution inspection.

Evidence in the October 21 investigation workspace: `work/exact-replay`, `work/visual-exact-replay`, `work/edition-visual`, and `work/editable-roundtrip-v3`. Large private snapshots, font files, PDFs, and INDD packages are kept outside Git.

## Validation checkpoint

- Both complete candidate browser PDFs: 44 Letter pages each, successful production Chromium export.
- Full unit suite: 117 files / 1,031 tests passed with one worker. Parallel export/test activity previously caused repository-test timeouts; no assertions or test timeouts were relaxed. The focused native-export suite also passes (6 files / 24 tests).
- Build/typecheck passed.
- Existing Playwright suite: 89 passed initially; the seven failures were corrected and passed targeted rechecks. Corrections covered a foreign process on the mock MCP port, licensed-font assumptions in a disposable test store, missing font assets in a test-only PDF request, and disk exhaustion. Full market-asset generation passed.
- Firefox and WebKit template selection: passed, including both previews and all 18 default detailed submarkets.
- Frozen live fixture: snapshot `snapshot-5454ea2d-5c44-4f4c-bc78-c937c782c402`, SHA-256 `f9900d2210b6b771d59a72a39fe122b4dd0f55188f98487c74203be194cd1dfd`. Both families save/reopen exactly and freeze without mutating their source. Classic captures 141 assets; Geographic 67; each pins 16 font resources. The fixture has 18 maps, 17 selected Lee listings, and an explicit empty I-57 result. Narratives are not invented.
- Full Classic native candidate: 44 pages, 1,271 native text frames, 58 native tables; zero missing links, substituted fonts, overset frames/cells; successful reopen and relocation. Final crop/shadow adjustments and application package acceptance are tracked separately.
- Original report, template, and map-input preservation check passed after test fixture preparation.
- Final browser acceptance created, saved, reopened, inspected, and downloaded both 44-page PDFs through the application. All 41 source/report/map files remain hash-identical; all 15 earlier template registry records remain unchanged, with only two new draft editions added.
- Native visual review at 150 DPI found missing shared table row rules and incorrect closing-page image/panel order. The native mapper now retains computed border rules on both sides of shared cell edges, preserves DOM paint order for closing artwork, and retains justified text spacing. A three-page Desktop sample (overall table, overview, company closing page) passes with 279 text frames, 4 tables, zero validation defects, reopen and relocation; readable-resolution inspection confirms the corrections.
- Native capture mounts, measures, and captures one fixed-size frozen page at a time, keeping off-page maps and artwork out of the live DOM. Each page's PDF supplies placement baselines only; editable content comes from the report and DOM. It reads the ready DOM directly rather than repeating interactive locator prechecks, and obsolete print-job fetches are cancelled. Preparation has a ten-minute deadline and does not start Adobe execution on failure. Job status is non-cacheable. This is separate from the closed historical PDF timeout investigation.

The historical PDF command-timeout investigation is closed. Fresh small, multi-submarket, deadline-cleanup, and full-report lifecycle tests passed. Do not reopen the historical execution indicator without new evidence.

## Remaining release gates

October 22 recovery checkpoint: the affected Geographic page 14 and surrounding pages 13–16 passed isolated capture. Controlled capture-only runs then completed all 44 pages in each family: Classic in 128 seconds and Geographic in 202 seconds. Each retained 44 page artifacts, one initial navigation, no page crashes, and Chromium exit code zero. Peak sampled Chromium process-tree working sets were 1,666 MiB and 1,835 MiB respectively; no memory-exhaustion event was observed. Both verified prepared inputs are retained for independent Adobe assembly. Capture now records owned-process stderr, exit/disconnect/navigation/crash events, memory samples and exact page/element stages, with a per-page deadline and completed-page artifacts. No template artwork or native geometry was changed in this recovery. The current build and focused InDesign tests (5 files, 23 tests) pass.

The old execution-context error cannot be assigned a definitive cause from its limited logs. Windows sleep/hibernate events coincide with the failure window; they are evidence of interruption, not proof of a Chromium defect. Subsequent October 22 restart events explain why the later Classic process was no longer running. The historical PDF timeout investigation remains closed.

The current external blocker is an InDesign 21.6 startup crash in `MSVCP140.dll` (Windows exception `0xc0000005`, COM activation `0x80080005`). It occurred during session inspection before dispatch. The user reproduced the crash by opening Desktop normally and is arranging repair. No native execution claim was created for the prepared Geographic input. Do not publish the candidate editions or merge the release until the repaired Desktop completes both final packages and their acceptance checks.

Complete final Chromium page inspection, final native Classic/Geographic package downloads, native visual review, and local publication of accepted new template versions. Then commit/push the intended changes, merge the validated pull request, fast-forward local main to the accepted GitHub commit, and verify the application from that commit. This document is a checkpoint, not a production-ready declaration.

Use `docs/git-synchronization.md` for the repeatable synchronization workflow. Rollback must preserve reports and captured assets and must not restore an old whole registry over later user edits.
