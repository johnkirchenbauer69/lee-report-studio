# Canonical report implementation checkpoint

## Current status (2026-10-21)

The independent Classic and Geographic families exist as local drafts. Neither is published to the hosted application. The historical Q3 v1.20.0 family and its reports are preserved. This checkpoint is not a completed release.

Classic is forked only when the approved source ID, version and SHA-256 match. Geographic expands to 44 pages using the same fixed pages and 18 pairs of market overview/activity pages. Its featured card selects only the matching period/submarket's qualifying Lee listing. An explicit empty result does not borrow another market's listing. Listing hyperlinks remain absent when no verified source URL exists.

Report creation defaults canonical editions to Salesforce and all 18 detailed submarkets. Geographic creation rejects snapshots without pinned activity maps and featured-selection decisions. Both designs use distinct names and approved design preview images. Saved report cards identify the family.

## Validated locally

- Build/typecheck passed; 1,007 tests passed from a clean archive of the committed implementation with four workers (the working checkout also passes 11 pre-existing shadow-mask tests, totaling 1,018). A separate isolated Playwright test verified both template choices, approved preview images, selected-family state, Ascendix default and all 18 detailed submarkets. It used published-choice fixtures and did not publish the real drafts.
- A clean committed checkout independently generated both 44-page PDFs without the unrelated local shadow-mask patch. All-page thumbnail comparison against the earlier QA run had a maximum mean RGB-channel difference below 0.019/255; readable page renders were also inspected. This validates that local patch is not required by this checkpoint.
- Both families rendered 44 US Letter pages through the application Chromium renderer. The latest run rejected missing images/fonts and sidebar/featured overflow; both PDFs passed. Narrative-layout and live-data/photo runs are separate fixtures.
- The earlier narrative-layout fixture uses the saved historical Q3 revision and deliberately empty featured cards. The later live-generation fixture contains 18 pinned vector maps and 17 qualifying featured listings; I-57 has an explicit empty selection. It does not invent or regenerate narratives.
- The live-generation fixture was replayed through the production generation, save, reopen and export-freezing code. Each family reopened exactly, retained the complete source metrics and submarket records, and froze offline assets without mutating its saved instance. Classic captured 136 unique assets; Geographic captured 62. Both retained nine font references used by these browser templates.
- The source fixture is `snapshot-5454ea2d-5c44-4f4c-bc78-c937c782c402`, SHA-256 `f9900d2210b6b771d59a72a39fe122b4dd0f55188f98487c74203be194cd1dfd`. It is a separate test edition, not a replacement for the approved publication.
- The complete display basemap library has 126 verified files. Original reporting polygons and precise property coordinates are unchanged; membership comes from source assignments, not spatial containment.
- Captured assets publish atomically without replacing existing content-addressed files. Both canonical families fail on missing/corrupt assets or size limits; legacy family behavior is unchanged.

Evidence is under the investigation workspace `work/canonical-featured-qa-v2`, `work/canonical-full-qa-v6`, `work/canonical-roundtrip-v6`, and `work/canonical-candidates-v6`. Large source maps, private snapshots and generated PDFs are deliberately outside Git.

Clean-checkout evidence is in `work/canonical-clean-pdf-v1` and `work/canonical-clean-tests.log`. The locally prepared basemap archive is `work/canonical-release-artifacts/geographic-basemaps-v1.zip` (143,068,441 bytes, SHA-256 `71e8b7c1bdb1937de94250cdca3726cd96daf498e88d8a43110fcfe239719557`). It contains 126 verified inputs plus the display manifest and has not been uploaded or deployed.

## InDesign status

The previously validated desktop scripts and Marketing masters remain unchanged. The new implementation has hash-pinned export contracts, complete offline input preparation, a durable workstation lock, at-most-once job claims, and rejection of occupied desktop sessions. Timeouts retain the lock and require operator recovery. Script completion is not package acceptance; validation separately requires native text/tables, resolved links/fonts, zero overset, save/reopen, relocation and a correctly sized QA PDF. IDML is omitted unless an actual import passes.

These controls have automated tests. A Windows COM adapter and operator command now implement active-session inspection, input revalidation and guarded dispatch; they have unit tests but have not been exercised in a real native assembly run. They are not demonstrated full native exports for both new families. The versioned master integration, native assembly, actual InDesign round trips, package download UI and licensed execution provider remain release gates. Creative Cloud Desktop access is not treated as an API or Server entitlement. See `server/indesign/LOCAL-WORKER.md`.

## Release and rollback gates

1. Finish native master/assembly and full package validation, including editable closing-page content and actual IDML imports.
2. Complete browser template-selection and generation acceptance against the installed families; publish only validated family versions.
3. Remote main has been integrated without content conflicts; unrelated local changes remain uncommitted and preserved. Reverify the final release checkout after the remaining native exporter work.
4. Publish the immutable basemap library as a checksummed deployment artifact; do not place its large files in Git or silently fetch changing context during export.
5. Identify the hosted URL and authorized deployment route. GitHub currently exposes no service homepage/deployment URL. The Render connector is unused at the user's request.
6. Back up the deployment's template registry and data, deploy the same tested commit locally and hosted, and verify real generation/export on both. A Git push is not deployment proof.

Rollback code to the previous deployed commit without deleting reports or captured assets. Restore family publication metadata only after checking that the affected versions have not changed since the release manifest. Existing reports pin their template version and source snapshot. Do not restore an entire old registry over later user edits. Local pre-install template evidence is in `work/canonical-template-backup-v1`; no historical report or template was rewritten by installation.

## QA command lifecycle investigation (2026-10-21)

No canonical QA or owned Chromium process remained when the reported 53-minute hang was investigated. The previous clean run wrote Classic at 13:12:34, Geographic at 13:13:02, and its completion record at 13:13:02 local time. Historical logs do not establish a 53-minute renderer stall; a stale execution indicator is plausible, not proven. No unrelated application process was terminated.

Confirmed reliability defects were sparse completion-only logs, no command-wide deadline, unbounded PDF/cleanup operations, server cleanup not awaited, setup outside cleanup protection, and a swallowed narrative-refit timeout. The command now uses an independent supervisor with a five-minute default deadline (maximum configurable ten minutes), graceful cancellation and a ten-second cleanup allowance before terminating only its owned Windows child process tree. Renderer phases have a three-minute total budget; browser closure runs in finally with an owned-browser kill fallback. Servers close active connections and await closure. Readiness/refit errors fail explicitly. There are no automatic retries or lowered rendering checks.

The optional sixth positional argument selects comma-separated canonical submarket IDs, rendering their Geographic page pairs without changing the frozen source. Example: `central-dupage,north-dupage,i80-joliet`. Omitting it retains both full reports. JSON-line progress includes planned page/submarket/map identities, actual page image inventory, phase, pending requests, CPU time and memory. Chromium prints each document in one operation, so the PDF-print phase applies to all listed pages; it does not claim a fictitious per-page print cursor.

Evidence retained under investigation workspace `work/canonical-diagnostic-*`:
- Central DuPage: two pages, 6.2 seconds, exit 0; repeated successfully after error-message instrumentation.
- Central DuPage, North DuPage, I-80/Joliet: six pages, 10.2 seconds, exit 0.
- Forced 2.5-second command deadline: cancellation during readiness, browser/server cleanup, exit 1 after 2.7 seconds, no surviving QA process.
- Deliberately missing map in a separate disposable fixture: named asset failure, cleanup, exit 1 after 2.9 seconds.
- Invalid submarket ID: explicit failure/exit 1, no render.
- Both complete reports after small tests passed: 44 Letter pages each, 78.1 seconds total, no narrative overflow, exit 0. Waiting time was PDF printing, with no pending asset requests. All 88 page thumbnails matched the prior successful PDFs exactly at 36 dpi. This comparison is a regression check, not a substitute for the earlier readable-resolution design review.

No report data, source map geometry, quality setting or validation requirement was relaxed. Prior results and all source assets remain intact.
