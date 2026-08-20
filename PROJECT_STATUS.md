# Project Status

## Productionization milestone

The reference workflow now runs from source selection through normalized data, reconciliation, editable report generation, preflight, visual comparison, and deterministic multipage PDF output.

### Delivered

- Approved four-page Q2 2026 Overall Market reconstruction
- Strict Industrial Market Report schema and central formatting/calculations
- Auditable provenance records and non-destructive approved-value overrides
- Sample, JSON, Excel, and Ascendix-boundary providers
- Five-step creation wizard and progress-aware generation pipeline
- Versioned report snapshots and manual-override tracking
- Repeating component/page engine with contextual bindings
- Native SVG chart primitives and chart-data inspector
- Chromium PDF render-job API, print route, and `pdf-lib` fallback
- Font, image, binding, conflict, geometry, and overflow preflight
- Approved-PDF visual baselines, CI diffs, and similarity reporting
- Existing creative editor capabilities including crop, proportional group resize, page drag ordering, rulers/guides, and disk-backed development assets
- Cross-platform Vitest/Playwright ownership isolation and diagnosable Quality workflow artifacts
- Production-provider isolation with no sample fallback and explicit section completeness
- Independent calculation scope/detail-page selection with auditable derived-metric lineage
- Business constraints, request consistency, conflict/override rules, and computed publication readiness
- Shared deterministic Report Data Service used by HTTP and MCP interfaces
- Server-only Salesforce client, injectable Ascendix adapter, centralized unverified field mappings, and explicit historical/current pathways
- Versioned immutable report-data snapshots with canonical SHA-256 hashes and ReportInstance references
- Semantic MCP data, validation, conflict, provenance, and status tools with no raw SOQL/write surface
- Fake Salesforce adapter contracts plus HTTP/MCP report/hash parity coverage in CI
- Provider isolation, fixture-leak, cross-quarter, invalid-rate, negative-absorption, scope, and lifecycle tests

## Verified reference fidelity

The calibrated page similarity floors are cover 96%, table 95%, overview 88%, and highlights 88%. Differences are concentrated in unavailable licensed fonts, browser text rasterization, and approved raster chart content. See `VISUAL_REGRESSION.md` for the policy.

## Not yet production-complete

- Licensed brand font packaging and final typographic sign-off
- Full Excel mapping for every report section and arbitrary workbook variants
- Production Ascendix field-name verification, credentials, retry/backoff policy, and live sandbox certification
- Durable snapshot/report persistence and MCP `create_market_report`
- Authenticated/durable PDF queues and artifact storage
- Database-backed templates/reports, permissions, and collaborative editing
- Native chart replacement of every approved raster chart
- Rich-text runs, accessibility audit, and cross-browser editor certification

Partial Excel reports intentionally remain editable drafts. Their absent sections render explicit empty states and cannot be approved or published when the selected template requires those sections.

## Recommended next sequence

1. Secure the service boundary and persist report/template/job entities.
2. Complete the production Ascendix adapter and full workbook mapping.
3. License and embed approved fonts, then tighten visual thresholds.
4. Replace reference raster charts one at a time with native accessible SVG charts.
5. Add approval/version publishing, role permissions, and audit history.
