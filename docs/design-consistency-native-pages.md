# Design consistency and native closing pages

## Implementation

All 19 Market Indicators tables share source Overall Market typography, 9px Nunito Sans, 700-weight metric/current values, 400-weight history, 1px separators, padding, alignment, and SVG geometry. Numerical increases use green `#8A941E`; decreases use bright red `#CD1442`; confirmed unchanged uses maroon `#4E131E`; unavailable comparisons use muted gray `#6B7280`. Analytical favorable/unfavorable status remains separate. Missing/nonfinite values remain unavailable. Market calculations, Salesforce data, and ingestion were not changed.

Methodology and Definitions now use structured heading/term/description records. Contacts use departments and records with name, title, email, department, display order, and active status. The source roster contains 45 contacts. Who We Are uses editable narrative paragraphs, three statistics, and 74 office openings. The supplied four-page PDF is the initial content and appearance authority; no current personnel or corporate claims were inferred.

The Inspector supports editing, adding, removing, and reordering records, moving definition items between sections, and changing contact departments. Apply content changes updates the template canvas; existing Save/reopen persists the draft. Schema validation rejects malformed email addresses, duplicate IDs, and unknown departments. Published template immutability remains in the existing repository. The explicit migration clones only the four closing pages into a new draft; stored versions are not automatically migrated.

The source logo artwork and map remain isolated graphics. Page text, contact hyperlinks, statistics, and office timeline are native DOM content rendered by the existing Chromium exporter. There are no closing-page screenshots. The map retains its original roughly 144dpi resolution. The source logos contain original embedded raster layers inside SVG assets; these are not claimed to be entirely vector artwork. Directional symbols are vector SVG. Approved local Nunito Sans and Avenir Next LT Pro fonts are embedded during export; no proprietary font binaries were added to the repository.

Top Sales and Top Leases retain their approved column geometry. Browser QA verifies Ares Management and longer buyer/tenant strings wrap inside cells and the table boundary. No transaction-layout code change was needed.

## Architecture

`closingContent` is an optional typed field on existing text elements. `ClosingContent` renders it identically in canvas and print; `ClosingContentEditor` edits the structured payload. Zod persistence validates the same union. `closingPageContent` supplies reference seeds; `withNativeClosingPages` implements the explicit migration. The normal draft repository saves revisions and protects published versions. `INDICATOR_STYLE` and shared table CSS govern indicator presentation.

The renderer rejects closing-page overflow or missing assets instead of exporting clipped content. Inspector overflow feedback lets editors shorten/reflow content. Arbitrarily large additions do not automatically paginate. The older pdf-lib fallback rejects native closing pages because it cannot faithfully reproduce their text and links; the Chromium exporter supports them.

## Visual and PDF evidence

See [evidence](evidence/design-consistency/): each closing-page comparison shows the supplied PDF on the left and native PDF on the right at exactly 612 × 792 points. The indicator comparison shows Overall Market above a submarket at equal scale; the real sample provider has no submarket history. Separate Overall/submarket fixture screenshots supply identical historical periods to all 19 tables to verify populated typography and dynamic Q4 labels. Fixture values are presentation QA, not new market evidence. Layout metrics confirm all 19 tables share styles and all four closing bodies fit their bounds.

The sample-provider full report contains 44 pages. PDF validation confirms selectable/searchable closing-page text, 45 `mailto:` annotations, embedded fonts, no full-page closing-page raster, and unchanged extracted text, link targets, and closing-page rendered pixels after lossless compression. The report decreases from 24,851,601 bytes to 23,086,938 bytes; exact final sizes are in `pdf-validation.json`. Existing report images dominate the size.

Remaining visual differences: native font metrics and line flow produce modest vertical spacing/wrapping differences from the source, especially Methodology and company narrative. The native pages are source-faithful compositions, not pixel-identical replicas. Source roster, office count, timeline, and statistics still require editorial verification before publication.

## Validation

- `npm test`: 90 files, 687 passing tests, zero failures on the isolated review branch.
- `npm run build`: TypeScript and production build pass; existing bundle-size warning remains.
- `npx playwright test --config playwright.native-closing.config.ts`: five passing tests, zero failures. API calls are mocked; this proves rendering/editor save behavior, not live Salesforce behavior. Disk repository tests separately verify draft save/reopen and published immutability.
- `npx tsx scripts/verify-native-closing-pages.ts`: real existing local Chromium PDF endpoint, sample provider, 44 pages, 19 tables, closing overflow checks pass.
- `python -X utf8 scripts/validate-native-closing-pdf.py <source-pdf>` and `npx tsx scripts/compare-native-closing-pages.ts`: PDF structural, hyperlink, font, compression, and visual evidence checks pass.
- `git diff --check`: passes. No standalone lint script is configured; new TypeScript/CSS files were formatted with Prettier.

The initial delivery could not run the full established visual suite because its isolation guard rejected the non-test API and isolated startup was blocked. In the PR #39 follow-up, the established suite runs on separate web/API/MCP ports with disposable storage and the original global isolation guard. No skip conditions, visual thresholds, or production styling were weakened. Existing fixture-dependent guards still require the historical v1.8.0 template, a published template, and the approved 113-face local font store; these assets are absent from the clean CI test store. Full-run and GitHub results are reported in the PR handoff.

## Local review and delivery

Local preview: <http://127.0.0.1:3108>. Select unpublished draft `1.21.0`, derived from preserved `1.20.0`. Published `1.15.0` was unchanged. This is a local running preview, not a publicly hosted deployment. Choose a closing page in Pages, select its body, edit Closing page content in Inspector, Apply content changes, then Save. The API draft was reopened and inspected after creation.

The clean review branch is `codex/design-consistency-native-pages-review`, based on `a4e5c55`. It excludes unrelated pre-existing changes in the original workspace. The PR is for review and must remain open; no merge or deployment was performed.

## Files

The following inventory lists every implementation and evidence file in this change. Tests accompany the renderer, editor persistence, schema, migration, indicators, typography, export behavior, and long-cell QA.

- `docs/design-consistency-native-pages.md`
- `docs/evidence/design-consistency/comparison-contacts.png`
- `docs/evidence/design-consistency/comparison-data-methodology.png`
- `docs/evidence/design-consistency/comparison-definitions.png`
- `docs/evidence/design-consistency/comparison-indicators.png`
- `docs/evidence/design-consistency/comparison-who-we-are.png`
- `docs/evidence/design-consistency/layout-metrics.json`
- `docs/evidence/design-consistency/pdf-validation.json`
- `playwright.native-closing.config.ts`
- `public/report-assets/closing/corporate-logo.svg`
- `public/report-assets/closing/header-logo.svg`
- `public/report-assets/closing/office-map.png`
- `scripts/compare-native-closing-pages.ts`
- `scripts/create-native-closing-template-draft.ts`
- `scripts/validate-native-closing-pdf.py`
- `scripts/verify-native-closing-pages.ts`
- `server/renderers/chromiumPdfRenderer.ts`
- `server/templates/nativeClosingPersistence.test.ts`
- `src/components/CanvasElement.test.tsx`
- `src/components/CanvasElement.tsx`
- `src/components/ClosingContent.tsx`
- `src/components/ClosingContentEditor.tsx`
- `src/components/Inspector.tsx`
- `src/data/closingPageContent.ts`
- `src/data/sampleTemplate.ts`
- `src/data/staticPageHeaders.test.ts`
- `src/report-engine/closing/closingContent.test.tsx`
- `src/report-engine/closing/closingContent.ts`
- `src/report-engine/closing/migrateClosingPages.ts`
- `src/report-engine/generation/generateReport.test.ts`
- `src/report-engine/generation/prepareTemplate.test.ts`
- `src/report-engine/indicators/indicatorStyle.test.ts`
- `src/report-engine/indicators/indicatorStyle.ts`
- `src/report-engine/indicators/metricSemantics.test.ts`
- `src/report-engine/indicators/metricSemantics.ts`
- `src/report-engine/schema/reportInstancePersistence.ts`
- `src/services/pdfExport.test.ts`
- `src/services/pdfExport.ts`
- `src/styles/advanced.css`
- `src/styles/closing-pages.css`
- `src/types/report.ts`
- `tests/visual/native-closing-pages.spec.ts`

- `docs/evidence/design-consistency/indicator-overall-fixture.png`
- `docs/evidence/design-consistency/indicator-submarket-fixture.png`

## PR #39 CI follow-up

The visual loader used locally installed but undeclared `unpdf`. It is now pinned as development-only dependency `1.8.1` with its lockfile entry. The existing `pdf-lib` remains responsible for PDF structure/annotations; it is not a text extractor. A fresh `npm ci --ignore-scripts` in a separate dependency-check directory resolves the declared parser without relying on the original shared node_modules. CI continues to use normal `npm ci` on Node 22.

New HTTP/UI lifecycle coverage verifies publication-mode `/api/render/pdf` (no draft preflight bypass), exact Chromium producer metadata, four pages, searchable reference terms, and all 45 email links. Two further tests create disposable drafts through the isolated API, edit and reorder contacts/office openings in the Inspector, Save with a successful PUT, read back content/order from the API, reopen the version, verify rendered order and contact links, and delete their drafts. All three focused tests pass.

The benchmark fixture now resolves native page-number placeholders with the same `expandTemplatePages` function used during report generation. Four legacy image-page baselines were replaced with the already-approved native compositions; other baselines and all pixel thresholds remain unchanged. The indicator browser/print test now asserts direction colors, vector path geometry, neutral/missing dash dimensions, and an arrow for changing Under Construction, rather than obsolete text glyphs and favorable/unfavorable colors.

Additional changed files:

- `package.json`
- `package-lock.json`
- `src/renderers/browser/BenchmarkPage.tsx`
- `tests/visual/report-pages.spec.ts`
- `tests/visual/native-closing-lifecycle.spec.ts`
- `tests/visual/baselines/data-methodology.png`
- `tests/visual/baselines/definitions.png`
- `tests/visual/baselines/contacts.png`
- `tests/visual/baselines/who-we-are.png`
