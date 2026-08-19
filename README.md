# LEE Report Studio

LEE Report Studio is a browser-based report production system for building editable, data-backed commercial real estate reports. The current reference workflow reproduces the approved four-page Q2 2026 Chicago Industrial Overall Market report and keeps source data, presentation exceptions, template geometry, editing, and export as separate concerns.

## What works

- Five-step report wizard for template, period, source, geography, and review
- Strict Zod-based Industrial Market Report schema with raw numeric values
- Sample, JSON, and Q2 workbook providers plus a server-only Ascendix adapter boundary
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

Update approved visual baselines only after intentional review:

```bash
npm run test:visual:update
```

Visual failures write actual, expected, and diff images to `test-results/` and the HTML report to `visual-report/`.

## Production flow

```text
Report request
  -> provider (sample / JSON / Excel / Ascendix)
  -> strict normalized report schema
  -> calculations + provenance reconciliation
  -> presentation adapter
  -> template bindings + repeat expansion
  -> versioned editable report instance
  -> preflight
  -> Chromium PDF job (or browser fallback)
```

See [ARCHITECTURE.md](ARCHITECTURE.md), [REPORT_DATA_MODEL.md](REPORT_DATA_MODEL.md), [DATA_PROVIDERS.md](DATA_PROVIDERS.md), [RENDERING.md](RENDERING.md), and [VISUAL_REGRESSION.md](VISUAL_REGRESSION.md).

## Local storage

Templates and report editing state currently persist in LocalStorage. Uploaded assets are written by the local API to `server/data/assets`; generated files and the manifest are gitignored. Set `LEE_DATA_DIR` to relocate this development data root.

## Current production boundaries

- Exact Avenir/Nunito font files are not distributed in this repository; approved licensed files must be supplied before final brand typography sign-off.
- Excel v1 maps the supplied Q2 submarket sheet. Sections absent from that workbook are populated from the Q2 reference fixture and labeled by provenance.
- The Ascendix provider is a server-only integration contract, not a configured production endpoint.
- Approved raster chart exports remain in the four-page fixture until native SVG charts reach the same visual fidelity.
- `/api/render/pdf` is a local transient job service without authentication, durable queues, or object storage.
- LocalStorage and disk-backed assets require database/object-storage replacements for multi-user production.

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
