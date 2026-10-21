# Canonical report implementation checkpoint

## Current status (2026-10-21)

The independent Classic and Geographic families exist as local drafts. Neither is published to the hosted application. The historical Q3 v1.20.0 family and its reports are preserved. This checkpoint is not a completed release.

Classic is forked only when the approved source ID, version and SHA-256 match. Geographic expands to 44 pages using the same fixed pages and 18 pairs of market overview/activity pages. Its featured card selects only the matching period/submarket's qualifying Lee listing. An explicit empty result does not borrow another market's listing. Listing hyperlinks remain absent when no verified source URL exists.

Report creation defaults canonical editions to Salesforce and all 18 detailed submarkets. Geographic creation rejects snapshots without pinned activity maps and featured-selection decisions. Both designs use distinct names and approved design preview images. Saved report cards identify the family.

## Validated locally

- Build/typecheck passed; 1,018 tests passed with four workers. A separate isolated Playwright test verified both template choices, approved preview images, selected-family state, Ascendix default and all 18 detailed submarkets. It used published-choice fixtures and did not publish the real drafts.
- Both families rendered 44 US Letter pages through the application Chromium renderer. The latest run rejected missing images/fonts and sidebar/featured overflow; both PDFs passed. Narrative-layout and live-data/photo runs are separate fixtures.
- The earlier narrative-layout fixture uses the saved historical Q3 revision and deliberately empty featured cards. The later live-generation fixture contains 18 pinned vector maps and 17 qualifying featured listings; I-57 has an explicit empty selection. It does not invent or regenerate narratives.
- The live-generation fixture was replayed through the production generation, save, reopen and export-freezing code. Each family reopened exactly, retained the complete source metrics and submarket records, and froze offline assets without mutating its saved instance. Classic captured 136 unique assets; Geographic captured 62. Both retained nine font references used by these browser templates.
- The source fixture is `snapshot-5454ea2d-5c44-4f4c-bc78-c937c782c402`, SHA-256 `f9900d2210b6b771d59a72a39fe122b4dd0f55188f98487c74203be194cd1dfd`. It is a separate test edition, not a replacement for the approved publication.
- The complete display basemap library has 126 verified files. Original reporting polygons and precise property coordinates are unchanged; membership comes from source assignments, not spatial containment.
- Captured assets publish atomically without replacing existing content-addressed files. Both canonical families fail on missing/corrupt assets or size limits; legacy family behavior is unchanged.

Evidence is under the investigation workspace `work/canonical-featured-qa-v2`, `work/canonical-full-qa-v6`, `work/canonical-roundtrip-v6`, and `work/canonical-candidates-v6`. Large source maps, private snapshots and generated PDFs are deliberately outside Git.

## InDesign status

The previously validated desktop scripts and Marketing masters remain unchanged. The new implementation has hash-pinned export contracts, complete offline input preparation, a durable workstation lock, at-most-once job claims, and rejection of occupied desktop sessions. Timeouts retain the lock and require operator recovery. Script completion is not package acceptance; validation separately requires native text/tables, resolved links/fonts, zero overset, save/reopen, relocation and a correctly sized QA PDF. IDML is omitted unless an actual import passes.

These controls have automated tests. They are not a connected Windows execution adapter or a demonstrated full native export for both new families. The versioned master integration, native assembly, actual InDesign round trips, package download UI and licensed execution provider remain release gates. Creative Cloud Desktop access is not treated as an API or Server entitlement. See `server/indesign/LOCAL-WORKER.md`.

## Release and rollback gates

1. Finish native master/assembly and full package validation, including editable closing-page content and actual IDML imports.
2. Complete browser template-selection and generation acceptance against the installed families; publish only validated family versions.
3. Review/integrate the remote main branch and retain unrelated local changes. The local PDF QA currently includes a pre-existing, separately owned shadow-mask renderer fix; verify the final release checkout before deployment.
4. Publish the immutable basemap library as a checksummed deployment artifact; do not place its large files in Git or silently fetch changing context during export.
5. Identify the hosted URL and authorized deployment route. GitHub currently exposes no service homepage/deployment URL. The Render connector is unused at the user's request.
6. Back up the deployment's template registry and data, deploy the same tested commit locally and hosted, and verify real generation/export on both. A Git push is not deployment proof.

Rollback code to the previous deployed commit without deleting reports or captured assets. Restore family publication metadata only after checking that the affected versions have not changed since the release manifest. Existing reports pin their template version and source snapshot. Do not restore an entire old registry over later user edits. Local pre-install template evidence is in `work/canonical-template-backup-v1`; no historical report or template was rewritten by installation.
