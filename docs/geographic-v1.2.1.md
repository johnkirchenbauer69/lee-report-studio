# Geographic v1.2.1 editorial edition

This edition changes featured-property card text and Overall Market cartography. It retains the 44-page architecture, existing photographs and navy panels, reporting boundaries, source records, Top 3 selections, and all 18 submarket map assets. Classic v1.1.0 and Geographic v1.2.0 are independent immutable editions.

## Cards

The upper-left burgundy chip identifies lease, sale, combined availability, LEASED, or SOLD. City/state no longer repeats the marketing type. Unknown source marketing types remain neutral rather than inventing a transaction type. Only a verified HTTP(S) listing URL enables the separate upper-right CTA and photograph hyperlinks.

Chip and CTA backgrounds are explicit native shapes. Their text uses the pinned bold face. The northeast arrow is a small editable vector polygon beneath the transparent CTA link: the approved Nunito font does not contain that glyph in InDesign. No changes to the validated desktop assembly pipeline are needed. Missing URLs hide both the CTA and its arrow/background.

## Regional map

`prepareRegionalV121` uses the existing Variant B renderer. Regional road weights are 65% of the submarket weights; local streets are omitted and municipality labels are capped. Land, water, natural areas, boundaries, markers, vector output and drawing order share the existing palette and renderer.

The regional context contains complete Census TIGERweb primary/secondary road and municipality populations for the framed extent. Water polygons use the regional visibility filter `AREAWATER >= 100000`. Lake Michigan is authoritative Census Hydro geometry, with the label checked against a feature named Michigan. No shoreline is drawn manually. Reporting boundaries and pale-green parks come from checksum-verified existing Variant B inputs.

The prepared local context is `server/data/geographic-basemaps/regional-v121/context.json`, SHA-256 `8c8be934a75ff51964f5487f4e4574ea93a89c85e6864209591a84e54d71470a`. Its adjacent manifest retains source URLs, capture counts and hashes. Runtime checks the context hash; frozen reports additionally pin the resulting SVG and its bytes. Context capture is separate from report export and never runs during PDF or desktop assembly.

## Preparation and acceptance

Use the existing approved local data installation. Private reports, licensed font binaries and captured data are intentionally outside Git. Do not replace them with sample data.

1. Fetch GitHub before starting and use a feature branch. Preserve unrelated untracked work.
2. On a new installation, restore the verified Variant B dataset and its regional context. `scripts/capture-regional-v121.ts <verified-v1-root> <new-regional-directory>` can create a new capture with count/pagination evidence; it refuses an existing output directory. Review changed source data before adopting a new capture.
3. `npx tsx scripts/prepare-geographic-v121.ts` derives a separately versioned draft from the approved v1.2.0 checksum. It refuses an existing v1.2.1 edition. Subsequent draft changes use the repository's revision-checked save operation.
4. `scripts/geographic-v121-frozen-qa.ts <preserved-report.json> <new-output.json>` reuses saved report data, keeps all submarket maps and captures the new regional map. It does not query or mutate Salesforce.
5. Run build, unit tests and `tests/visual/geographic-v121.spec.ts`, including v1.2.0 regression coverage. `scripts/geographic-v121-browser-qa.ts <frozen-report> <new-directory>` creates the real 44-page browser PDF and screenshots, rejecting JavaScript errors and broken image requests.
6. `scripts/geographic-v121-card-fixture.ts <frozen-report> <new-synthetic-output>` creates a separate six-card test fixture with every listing/deal status, missing URL, long street and nine-digit divisible range. It never saves to report storage. Three verified synthetic URLs produce six native hyperlinks (photo and CTA).
7. Use `scripts/native-export-smoke.ts` for a small test before all 44 pages. Desktop execution remains operator-started and uses the workstation-wide journal. Never bypass a lock or replay an uncertain job. Native acceptance includes links, pinned fonts, overset frames/cells, save/reopen and relocated-package validation. IDML remains excluded until actual native import validation succeeds.
8. Inspect printed output at 250 DPI: Overall Market, Central DuPage, Lake County, O'Hare, featured cards, cover, tables, charts and closing. Compare native and browser artwork. Font anti-aliasing or existing shadow-mask normalization does not justify changing source layout or undoing transparency corrections.
9. Publish the accepted v1.2.1 draft through the normal repository lifecycle. This archives the previous Geographic selection while preserving its template content/checksum and saved reports. Classic remains published unchanged. Merge only after GitHub checks pass, fast-forward local main, verify equal hashes, rebuild/restart the local application and verify the published selector.

Buildout backfill, Salesforce data updates, hosted deployment and future publishing integration are outside this edition.
