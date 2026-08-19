# LEE Report Studio

LEE Report Studio is a browser-based report production system for building editable, data-backed commercial real estate reports. The current reference workflow reproduces the approved four-page Q2 2026 Chicago Industrial Overall Market report and keeps source data, presentation exceptions, template geometry, editing, and export as separate concerns.

## What works

- Five-step report wizard for template, period, source, geography, and review
- Strict Zod-based Industrial Market Report schema with raw numeric values
- Isolated sample, JSON, Excel, and server-only Ascendix provider boundaries; production providers never fall back to fixtures
- Explicit per-section completeness, imported-field provenance, calculation lineage, and publication readiness
- Independent overall-market calculation scope and detailed-page selection
- Central calculations, formatting, field provenance, reconciliation notes, and approved presentation overrides
- Versioned report instances containing immutable generation parameters and source-data snapshots
- Repeating pages and repeating components with local binding contexts
- Four-page editable Q2 reference template with native SVG chart infrastructure
- Full editor interactions: crop, group resize, page reordering, rulers, custom guides, asset storage, undo/redo, and QA
- Deterministic server-side Chromium PDF jobs with browser `pdf-lib` fallback
- Export preflight for missing fonts/images, unresolved bindings, overflow, and data conflicts
- Approved-PDF visual baselines with per-page regression scores and diff artifacts in CI

This is a focused report-production application, not a general-purpose Canva replacement.

## Run locally

Use Node.js 20 or newer (Node 22 recommended):

```bash
npm install
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

`npm test` is explicitly limited to `src/**/*.test.*` through Vitest. `npm run test:visual` is explicitly limited to `tests/visual/**/*.spec.*` through Playwright. A cross-platform ownership check rejects files placed in the wrong suite.

Update approved visual baselines only after intentional review:

```bash
npm run test:visual:update
```

Visual failures write actual, expected, and diff images to `test-results/` and the HTML report to `visual-report/`.

## Production flow

```text
Report request
  -> provider (sample / JSON / Excel / Ascendix)
  -> strict normalized report schema + completeness envelope
  -> scoped calculations + provenance reconciliation
  -> readiness validation
  -> presentation adapter
  -> template bindings + repeat expansion
  -> versioned editable report instance
  -> preflight
  -> Chromium PDF job (or browser fallback)
```

See [ARCHITECTURE.md](ARCHITECTURE.md), [REPORT_DATA_MODEL.md](REPORT_DATA_MODEL.md), [DATA_PROVIDERS.md](DATA_PROVIDERS.md), [DATA_INTEGRITY.md](DATA_INTEGRITY.md), [RENDERING.md](RENDERING.md), and [VISUAL_REGRESSION.md](VISUAL_REGRESSION.md).

## Local storage

Templates and report editing state currently persist in LocalStorage. Uploaded assets are written by the local API to `server/data/assets`; generated files and the manifest are gitignored. Set `LEE_DATA_DIR` to relocate this development data root.

## Current production boundaries

- Exact Avenir/Nunito font files are not distributed in this repository; approved licensed files must be supplied before final brand typography sign-off.
- Excel v1 maps the supplied submarket sheet only. Sections absent from a workbook remain empty, are declared missing, appear as empty states, and block publication when required by the template.
- Excel workbooks do not yet provide robust internal period metadata; the generation request supplies report period/market metadata while workbook name, sheet, cell, and import time remain traceable provenance.
- The Ascendix provider is a server-only integration contract, not a configured production endpoint.
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
