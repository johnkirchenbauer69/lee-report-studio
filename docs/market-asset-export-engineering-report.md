# Market Asset Export engineering report

## Implementation

Market Assets is a dedicated primary-navigation workspace at `/?marketAssets=1`. It lists saved report instances, prioritizes Published and Approved status, and clearly identifies Draft content. Users select actual saved markets, independently select any of eight categories, choose 2400- or 1200-pixel PNG output, preview the ZIP inventory and availability warnings, then generate and download an asynchronous export.

The export uses generated pages and the selected instance's saved data, narrative, overrides, report revision, template version/checksum, and generation date. It does not generate another report, calculate market rollups, query Salesforce or a data provider, load a current master template, generate narrative, or obtain new geographic data. The shared presentation adapter has an explicit saved-metrics mode that avoids totals/extremes calculations; the editor's existing default behavior is unchanged.

### Formats

| Category | Output | Source and handling |
| --- | --- | --- |
| Charts | One PNG per available saved chart instance | Existing `CanvasElement` and `MarketingChart`, saved bindings, adjacent chart title |
| Market Indicators | PNG and XLSX | Existing indicator table, saved period labels, native numbers and percent fractions |
| Top Leases and Sales | Separate PNGs and one XLSX | Existing tables and privacy-aware party display; `TopLeases` and `TopSales` worksheets |
| Market Statistics | XLSX | Available current metrics and historical fields; no new derived metrics |
| Market Narrative | DOCX | Exact saved rendered text/manual override, editable native Word paragraphs |
| Complete Market Section | PDF | Only selected saved market pages, original order and printed page numbers, existing production Chromium renderer |
| Property Highlights | Up to three PNGs and one XLSX | Existing cards; exactly one worksheet with three section headings and three formatted native tables when records exist |
| Submarket Map | PNG | Saved source and pinned bytes; raster detail limitation disclosed |

Empty narrative/history/transaction sources are omitted with warnings. An empty property section keeps one heading and one concise explanation, without synthetic blank records or repeated placeholders. The property workbook contains a native table only for a section with actual records.

### Provenance and pinned assets

`presentationAssets` is an optional, backward-compatible ReportInstance field. At **new instance creation**, the server captures supported local image and referenced font bytes as checksum-addressed files under `LEE_DATA_DIR/report-instance-assets/`, and stores only source/checksum/MIME/storage-key references in the ReportInstance. Ordinary report responses do not embed these binary bytes. Capture is bounded to 250 entries, 16 MB per asset and 64 MB in total. It never downloads an external URL. Back up this pinned-asset directory with the report-instance directory; references without their bytes cannot reproduce images. Existing saved reports are not backfilled during export. Subsequent document edits preserve this field; a newly introduced image that was not captured at creation is reported unavailable rather than silently resolving its current bytes.

The preview identifies the complete normalized saved-instance hash and revision. Job creation rejects a changed revision/hash with HTTP 409. The worker receives a deep copy of the selected instance. Captured asset checksums are verified, and managed fonts must match the saved references. Saved image bindings are set to their pinned sources in the render data, so current map defaults cannot replace them. Unavailable older assets are exposed in the preview and manifest; checksum/integrity failures fail the export. SVG sources referencing external resources are rejected.

The app's existing browser REST access policy applies. These endpoints do not introduce a separate credential scheme. Deployments that provide authentication in front of existing report APIs must apply the same boundary here. This change does not add multi-user ownership controls to an application that currently has none.

### Rendering and files

PNG rendering reuses `PrintPages`, `CanvasElement`, chart/table components, source style definitions, managed fonts, and manual text overrides. It crops the saved asset and relevant title/ribbon/card backgrounds, keeps its original page coordinates and crops that fragment, and renders directly at the requested device scale. Each PNG job reuses one Chromium browser with sequential disposable contexts. External requests are blocked. Image decode, blank-output, dimensions, and PNG width are checked. Transparency removes the page background; existing card fills and source raster backgrounds remain intact.

Section export calls the established `ChromiumPdfRenderer` through the shared render-job path and publication image preflight, with offline request restrictions for these frozen exports. PDF reopen verifies page count and the `LEE Report Studio Chromium renderer` producer. No completed full-report PDF is currently persisted in the ReportInstance model, so there is no existing verified PDF to extract; selected pages are rendered directly. A charts-only export never invokes the PDF renderer.

ExcelJS was already a production dependency. Workbooks use burgundy title/section headers, navy column headers, alternating white/gray rows, wrapping, native numeric formats, bold current-period values, frozen panes, table filters, and print settings. Missing values remain blank, `.0509` is stored as a numeric fraction and displayed as `5.09%`, and negative absorption remains negative. Each workbook is reopened immediately to verify values, numeric formats and topology. No formulas, links, macros or live calculations are introduced.

DOCX files use native OOXML paragraphs and styles, packaged with the existing `yazl` library. The saved model stores plain narrative text, not rich inline runs; paragraph order, blank paragraphs, wording and punctuation are retained. Inline bold/italic/link spans that were never saved cannot be reconstructed. No rewriting or additional market prose is performed. `yazl` moved from development to production dependencies because ZIP and DOCX generation now run in the server; no new parsing or office-generation library was introduced.

### ZIP layout and manifest

Single-market archives contain a market-named root and selected category folders. Multiple-market archives contain a quarter-named root with one readable folder per market. Unselected/empty folders are absent. Display names are sanitized for Windows characters, reserved names, traversal and path length, with readable case-insensitive collision suffixes. Internal IDs are confined to provenance metadata.

```text
I-55 Corridor/
  Charts/
  Market Indicators/
  Top Leases and Sales/
  Market Statistics/
  Narrative/
  Complete Section/
  Property Highlights/
  Map/
  ExportManifest.json
```

Each asset entry records filename, category, format, market, byte length, SHA-256 and warnings. The manifest records schema version, export time, report name/ID, reporting period, saved revision/hash, optional source snapshot hash, template version/checksum, generation date, selected markets/categories, omissions and completion status. The completed ZIP is reopened; its exact inventory, readable paths, manifest contents and every decompressed file checksum must agree before download becomes available.

### Job lifecycle and bounds

The worker has one active job and an eight-job admission limit including reservations for concurrent requests. States are Queued, Validating, Rendering, Packaging, Completed, Completed with warnings, Failed and Canceled. Progress counts processed assets. Cancellation is cooperative between assets. An active render may finish before cancellation takes effect; a canceled job has no download.

Jobs have a 15-minute runtime limit, 600-file selection limit, 512 MB output limit, 40-million-pixel render-surface/16000-pixel-output-height PNG guard and 2 GB retained-package budget. Large jobs use sequential asset writes rather than retaining every output buffer. Loose output files are removed after packaging/failure/cancellation. Job metadata uses atomic replacement. Completed downloads expire after 24 hours; hourly cleanup and startup/job admission cleanup remove expired artifacts. Interrupted jobs become failed after restart. This is a local process worker, not a durable external queue; a restart requires creating another job.

## Changed files

| Files | Responsibility |
| --- | --- |
| `src/components/MarketAssetWorkspace.tsx`, `src/styles/market-assets.css` | Workspace, selection, options, preview, progress, warnings and download |
| `src/App.tsx`, `src/main.tsx` | Navigation and workspace entry point |
| `src/report-engine/market-assets/contracts.ts` | Request validation, categories, plans, jobs and manifest contracts |
| `src/report-engine/market-assets/discovery.ts` | Saved market/asset discovery, fragment bounds, source payloads |
| `src/report-engine/market-assets/naming.ts` | Portable names, collision resolution and path guards |
| `server/market-assets/snapshot.ts` | New-save byte capture, snapshot hash, offline pinned render data |
| `server/market-assets/office.ts` | Native Excel and Word generation and workbook reopen verification |
| `server/market-assets/service.ts` | Bounded worker, PNG/PDF export, cleanup, ZIP creation and verification |
| `server/api/marketAssetRoutes.ts`, `server/index.ts`, `server/renderers/chromiumPdfRenderer.ts` | Export REST endpoints and production renderer integration |
| `server/api/reportInstanceRoutes.ts` | New-instance capture hook |
| `src/report-engine/schema/generation.ts`, `reportInstancePersistence.ts` | Optional persisted presentation assets |
| `src/report-engine/bindings/presentationModel.ts` | Saved-metrics rendering mode without market rollups |
| `src/renderers/browser/PrintReport.tsx` | Shared page renderer and persisted manual text overrides |
| `src/shared/salesforceIds.ts`, `presentationBytes.test.ts` | Keep base64 image/font bytes intact while retaining display-text sanitization |
| `server/market-assets/marketAssets.test.ts` | Discovery, Office types/topology, provenance, missing data, jobs, cancellation/recovery and paths |
| `tests/support/marketAssetFixture.ts`, `tests/visual/market-assets.spec.ts` | Synthetic 44-page/19-market fixture and browser/artifact workloads |
| `scripts/verify-market-asset-samples.mjs` | Independent package, native-format and content checks |
| `scripts/render-market-asset-office-qa.ps1` | Read-only Word/Excel rendering outside Vite's watched tree |
| `vite.config.ts` | Exclude generated evidence/Office temporary files from source watching |
| `package.json`, `package-lock.json` | Declare ZIP writer as production dependency |
| `.github/workflows/quality.yml`, `.gitignore` | CI evidence artifact and generated-output hygiene |
| `docs/evidence/market-assets/`, this report | Review evidence, inventories and validation results |

## Validation and evidence

The QA fixture is explicitly synthetic and Draft. It uses the existing sample source/template, adds labeled test-only submarket history, size buckets, contributor records and narrative to exercise all formats, and includes `.0509`, negative absorption and an authoritative null. These additions are confined to test storage. They are not historical market data, published content, Salesforce validation or a production backfill.

Commands:

```powershell
npm run typecheck
npm test
npm run build
$env:PLAYWRIGHT_PORT='3120'
$env:PLAYWRIGHT_API_PORT='8910'
$env:PLAYWRIGHT_MOCK_MCP_PORT='8911'
npm run test:visual
node scripts/verify-market-asset-samples.mjs
pwsh -NoProfile -File scripts/render-market-asset-office-qa.ps1
```

The existing isolation setup remains enabled. Fresh ports avoid the normal development API; `NODE_ENV=test`, disposable `LEE_DATA_DIR`, and the health-based test-storage guard prevent mutating specs from touching normal report/template storage. Existing golden images, skip conditions and comparison thresholds are unchanged. The new source-page PNG comparison has a 0.3% differing-pixel bound and also verifies target dimensions.

Browser evidence includes workspace/snapshot/category selection, a single-market preview, multi-market preview and completed export. Artifact evidence includes native Word and Excel renders, both original section PDF pages, manifests, benchmark inventories and independent artifact-validation results. Generated ZIP/PDF binaries are excluded from Git and uploaded by Quality CI as `market-asset-export-synthetic-qa` with 14-day retention. PNGs and JSON inventories are reviewable under `docs/evidence/market-assets/`.

Review the [workspace](evidence/market-assets/workspace.png), [single-market asset summary](evidence/market-assets/preview-single.png), [multi-market selection](evidence/market-assets/preview-multiple.png) and [completed export](evidence/market-assets/completed.png).

Native Office previews: [Market Indicators](evidence/market-assets/office-qa/Market%20Indicators-native-excel-1.png), [Top Leases](evidence/market-assets/office-qa/TopLeases-native-excel-1.png), [Top Sales](evidence/market-assets/office-qa/TopSales-native-excel-1.png), [current statistics](evidence/market-assets/office-qa/Current%20Statistics-native-excel-1.png), [historical statistics](evidence/market-assets/office-qa/Historical%20Statistics-native-excel-1.png), Property Highlights [page 1](evidence/market-assets/office-qa/Property%20Highlights-native-excel-1.png) and [page 2](evidence/market-assets/office-qa/Property%20Highlights-native-excel-2.png), and [editable Word narrative](evidence/market-assets/office-qa/narrative-native-word-1.png). Property Highlights is one worksheet, printed across two pages; all three tables remain on that worksheet.

The I-55 section PDF contains original source pages 11 and 12, in that order. Its [first page](evidence/market-assets/section-page-1.png) and [second page](evidence/market-assets/section-page-2.png) retain printed page numbers. Text extraction confirms the market name and saved synthetic narrative. Windows `pdffonts` inspection confirms six embedded, subset, Unicode-mapped Arial/Arial Black font entries. Native DOCX extraction confirms the saved narrative and its intervening blank paragraph exactly.

### Results

Typecheck and production build pass. Vitest reports **92 files and 697 unit/integration tests passed**, with no failures. Browser and visual checks run together in the existing Playwright suite: **65 passed, 12 existing guarded skips, zero failures** in 15.2 minutes. All four new export tests pass, including transparency, all formats/source immutability, single/multiple/19-market workloads, and the unchanged 0.3% source-page PNG comparison. Native closing production export and contacts/office editing, reordering, saving and reopening also pass.

GitHub Quality runs the same typecheck, unit/integration suite, build and full visual suite, followed by independent package verification. [PR #40 checks](https://github.com/johnkirchenbauer69/lee-report-studio/pull/40/checks) provide the authoritative status for the current review revision and the downloadable synthetic QA artifact.

The representative packages use one actual synthetic saved snapshot with 19 markets. Expected and independently reopened inventory:

| Package | Markets | Asset files | PNGs | XLSX files / worksheets | DOCX | PDF files / pages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| I-55 charts only | 1 | 4 | 4 | 0 / 0 | 0 | 0 / 0 |
| I-55 all available assets | 1 | 17 | 11 | 4 / 6 | 1 | 1 / 2 |
| I-55, O'Hare, I-80/Joliet | 3 | 51 | 33 | 12 / 18 | 3 | 3 / 6 |
| All saved markets | 19 | 323 | 209 | 76 / 114 | 19 | 19 / 38 |

`ExportManifest.json` is additional to these asset counts. Complete filenames and SHA-256 values appear in the [I-55 charts inventory](evidence/market-assets/I-55-charts-only-synthetic-manifest.json), [I-55 full inventory](evidence/market-assets/I-55-all-assets-synthetic-manifest.json), [three-market inventory](evidence/market-assets/multiple-markets-synthetic-manifest.json) and [19-market inventory](evidence/market-assets/all-19-markets-synthetic-manifest.json). The [independent artifact results](evidence/market-assets/artifact-validation.json) cover archive inventory, checksums, filenames, PNG dimensions, native numeric types, authoritative blanks, workbook topology, exact DOCX paragraph order and Chromium section PDFs. The [benchmark](evidence/market-assets/benchmark.json) records elapsed time, ZIP bytes and warning counts.

Independent validation passes for all five generated packages with zero omissions. High-resolution chart export took 8.596 seconds; the three-market package took 92.257 seconds; the 323-file all-market package took 509.634 seconds and was 190,594,171 bytes. The three- and 19-market packages carry three and 19 raster-map detail warnings respectively; these are disclosed source limitations, not export failures. The sample section retains original pages 11–12 and the supported Chromium producer. The all-market job stayed within its 15-minute, 512 MB package bounds.

All samples are named `*-synthetic.zip` under `docs/evidence/market-assets/` in the local worktree and the downloadable GitHub CI artifact. None is a production market report. The additional charts-plus-section package exercises source-page pixel comparison. Transparency has a separate four-chart browser check: each image has a transparent outer pixel and opaque artwork.

## Known limits and environment findings

- Older reports lacking pinned image bytes explicitly omit the affected PNG/PDF. They remain eligible for available native Office exports. Export never silently captures current bytes to repair old provenance.
- The source model does not retain narrative rich inline formatting. DOCX preserves saved plain text and paragraph structure.
- System fonts depend on the host's installed fonts. These Windows section previews embed Arial variants; Linux CI renders with its installed equivalents. Source-page comparison uses the same host for both renders. Managed font references must resolve to their recorded checksums, or the affected render is explicitly unavailable. The unavailable approved-font fixtures remain guarded skips; this delivery does not prove universal cross-platform font identity.
- Raster PNGs preserve the available native geographic/image detail; a 2400-pixel file does not create additional source detail.
- The filesystem worker is intended for the app's existing local server architecture, with bounded sequential rendering; it is not a distributed queue or persistent restart/resume system.
- Existing conditional visual skips depend on unavailable historical/published template versions and approved-font fixtures. Their guards are retained; skips do not prove those unavailable cases passed.
- The first broad run was interrupted after native Office produced a locked temporary file in Vite's source tree. That stopped the preview server and caused connection failures. Office scratch now stays outside the tree and generated evidence is ignored by Vite. This was a test-environment failure, not evidence of product layout regressions.
- New export checks found and fixed two product issues during implementation: corruption of base64 bytes by the display sanitizer, and Overall Market property discovery using a different binding structure from repeated submarkets.
- Source-render comparison exposed a small rasterization shift from translating fragments. Capture now keeps original page coordinates, and the comparison passes at its original 0.3% bound. Native transaction amounts also retain their original row index when placeholder rows are omitted, covered by a focused regression case.
- The packaged DOCX rendering helper could not run in this Windows Python environment because `pdf2image` was unavailable. Native Word rendering plus Poppler PNG inspection provided the actual document render validation instead; Excel was also opened read-only and rendered by native Excel.
- The production build retains an existing large-chunk advisory. No threshold was changed to hide it.

No merge, deployment, Salesforce write, credential change or live narrative/market research is part of this delivery. The feature branch is based on merged PR #39 (`6e530b3`), so its approved indicator colors, typography and native closing-page components are inherited directly.
