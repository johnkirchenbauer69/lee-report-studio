# LEE Report Studio

LEE Report Studio is a browser-based report production system for building editable, data-backed commercial real estate reports. The current reference workflow reproduces the approved four-page Q2 2026 Chicago Industrial Overall Market report and keeps source data, presentation exceptions, template geometry, editing, and export as separate concerns.

## What works

- Five-step report wizard for template, period, source, geography, and review
- Strict Zod-based Industrial Market Report schema with raw numeric values
- Isolated sample, JSON, Excel, and server-only Ascendix provider boundaries; production providers never fall back to fixtures
- One deterministic Report Data Service shared by the web API and semantic MCP tools
- Server-only Salesforce OAuth client, configurable Ascendix mapping, historical/current time contexts, and versioned query definitions
- Immutable normalized source snapshots with canonical SHA-256 change-detection hashes
- Explicit per-section completeness, imported-field provenance, calculation lineage, and publication readiness
- Independent overall-market calculation scope and detailed-page selection
- Central calculations, formatting, field provenance, reconciliation notes, and approved presentation overrides
- Versioned report instances containing immutable generation parameters and source-data snapshots
- Repeating pages and repeating components with local binding contexts
- Four-page editable Q2 reference template with native SVG chart infrastructure
- Full editor interactions: center-based element rotation, crop, group resize, page reordering, rulers, custom guides, managed asset storage, undo/redo, and QA
- Secure ZIP/direct font import with embedded metadata, SHA-256 deduplication, real family/weight/style controls, license status, and checksum-pinned report references
- Deterministic server-side Chromium PDF jobs with browser `pdf-lib` fallback
- Export preflight for missing fonts/images, unresolved bindings, overflow, and data conflicts
- Approved-PDF visual baselines with per-page regression scores and diff artifacts in CI

This is a focused report-production application, not a general-purpose Canva replacement.

## Run locally

Use Node.js 20 or newer (Node 22 recommended):

```bash
npm install
Copy-Item .env.example .env
npm run dev
```

Open `http://localhost:3000`. The command starts both Vite on port 3000 and the local API on port 8787.

## Validate

```bash
npm run typecheck
npm test
npm run build
npm run test:visual
```

For an optional live Salesforce check, create an ignored `.env` from `.env.example`, select `SALESFORCE_AUTH_MODE=client-credentials` or `soap-login`, then run `npm run salesforce:check`. Run `npm run salesforce:benchmark:q2` for the Chicago 2026 Q2 approved-fixture reconciliation. Neither command runs in normal CI.

`npm test` runs browser-domain tests under `src/**/*.test.*` and server integration tests under `server/**/*.test.*` through Vitest. `npm run test:visual` is explicitly limited to `tests/visual/**/*.spec.*` through Playwright.

Update approved visual baselines only after intentional review:

```bash
npm run test:visual:update
```

Visual failures write actual, expected, and diff images to `test-results/` and the HTML report to `visual-report/`.

## Production flow

```text
Report request
  -> provider (sample / JSON / Excel / Ascendix HTTP client)
  -> shared Report Data Service -> Ascendix adapter -> Salesforce
  -> strict normalized report schema + completeness envelope
  -> scoped calculations + provenance reconciliation
  -> readiness validation
  -> presentation adapter
  -> template bindings + repeat expansion
  -> versioned editable report instance
  -> preflight
  -> Chromium PDF job (or browser fallback)
```

See [ARCHITECTURE.md](ARCHITECTURE.md), [EDITOR_TRANSFORMS.md](EDITOR_TRANSFORMS.md), [FONT_ASSETS.md](FONT_ASSETS.md), [REPORT_DATA_SERVICE.md](REPORT_DATA_SERVICE.md), [SALESFORCE_INTEGRATION.md](SALESFORCE_INTEGRATION.md), [MCP_INTEGRATION.md](MCP_INTEGRATION.md), [REPORT_DATA_MODEL.md](REPORT_DATA_MODEL.md), [DATA_PROVIDERS.md](DATA_PROVIDERS.md), [DATA_INTEGRITY.md](DATA_INTEGRITY.md), [RENDERING.md](RENDERING.md), and [VISUAL_REGRESSION.md](VISUAL_REGRESSION.md).

## Local storage

Templates and report editing state currently persist in LocalStorage. Uploaded assets are validated and written by the local API under `server/data/assets`; generated binaries and the manifest are gitignored. Set `LEE_DATA_DIR` to relocate this development data root. Import organization fonts through the Fonts panel; never commit private uploads.

## Current production boundaries

- Approved Avenir/Nunito files are not distributed in this repository. The managed font system accepts the licensed organization bundle locally; brand typography still requires an approved license/source policy before deployment.
- Excel v1 maps the supplied submarket sheet only. Sections absent from a workbook remain empty, are declared missing, appear as empty states, and block publication when required by the template.
- Excel workbooks do not yet provide robust internal period metadata; the generation request supplies report period/market metadata while workbook name, sheet, cell, and import time remain traceable provenance.
- The Chicago Salesforce source hierarchy is live-verified: 18 Market_Data submarkets, Property_Data Overall headline, Market_Data historical trends, pooled/scoped contributor snapshots, and verified-derived speculative construction. Local permissions remain confirmable with `npm run salesforce:check`.
- Report snapshots are process-local and require durable persistence before multi-instance production deployment.
- MCP implements the read/validate/provenance subset; durable report-instance persistence is required before `create_market_report`.
- Approved raster chart exports remain in the four-page fixture until native SVG charts reach the same visual fidelity.
- `/api/render/pdf` is a local transient job service without authentication, durable queues, or object storage.
- LocalStorage and disk-backed assets require database/object-storage replacements for multi-user production.
- `npm audit` currently reports 0 critical, 0 high, and 2 moderate advisories through `exceljs -> uuid@8.3.2`. The advisory affects name-based UUID v3/v5 buffer handling; this importer reaches ExcelJS's UUID v4 conditional-formatting helper, not the affected path. No non-breaking upstream fix is currently available.

## Recommended main branch protection

- Require a pull request before merge.
- Require `Quality / validate` to pass.
- Require branches to be up to date before merge.
- Block merge whenever the Quality workflow is red.

## Keyboard shortcuts

| Action                | Shortcut                                   |
| --------------------- | ------------------------------------------ |
| Delete                | `Delete` / `Backspace`                     |
| Copy / Paste          | `Ctrl/Cmd+C` / `Ctrl/Cmd+V`                |
| Duplicate             | `Ctrl/Cmd+D`                               |
| Undo / Redo           | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z`          |
| Nudge / large nudge   | Arrow / `Shift+Arrow`                      |
| Group / Ungroup       | `Ctrl/Cmd+G` / `Ctrl/Cmd+Shift+G`          |
| Zoom in / out / reset | `Ctrl/Cmd++` / `Ctrl/Cmd+-` / `Ctrl/Cmd+0` |
