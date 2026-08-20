# Architecture

## Product boundary

LEE Report Studio is a data-driven business document editor. Source retrieval, normalization, calculation, presentation reconciliation, template layout, report instances, and rendering are deliberately independent domains.

## Runtime layers

| Layer                 | Primary location                                           | Responsibility                                                          |
| --------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| Source adapters       | `src/data-providers`                                       | Retrieve isolated source data plus metadata and completeness            |
| Salesforce client     | `server/integrations/salesforce`                           | Authenticate and execute controlled read-only SOQL server-side          |
| Ascendix adapter      | `server/integrations/ascendix`                             | Translate centralized Salesforce mappings into domain records           |
| Report data service   | `server/report-data-service`                               | Own retrieval, calculations, provenance, completeness, and snapshots    |
| HTTP / MCP interfaces | `server/api`, `server/mcp`                                 | Validate, call shared services, and serialize without business logic    |
| Report domain         | `src/report-engine/schema`                                 | Own strict semantic contracts and generation metadata                   |
| Calculations          | `src/report-engine/calculations`                           | Compute additive totals, weighted rates, and extrema from raw values    |
| Provenance            | `src/report-engine/provenance`                             | Preserve source choices, conflicts, and approved visible overrides      |
| Presentation adapter  | `src/report-engine/bindings`                               | Format semantic data for template consumption                           |
| Generation            | `src/report-engine/generation`                             | Validate, expand repeaters, and create versioned report snapshots       |
| Template/editor       | `src/types`, `src/components`, `src/App.tsx`               | Own geometry, styling, manual overrides, and creative-tool interactions |
| Browser renderer      | `src/renderers/browser`                                    | Render fixed-size pages for editing, print, and visual tests            |
| PDF renderers         | `server/renderers`, `src/renderers/pdf`                    | Produce server Chromium PDFs or invoke the browser fallback             |
| Validation            | `src/report-engine/validation`, `src/engine/validation.ts` | Report-data validation plus export preflight                            |

## Report instance boundary

A generated report records the template ID/version, generation request, timestamp, normalized data snapshot, source snapshot ID/hash/definition (for live Ascendix data), expanded pages, manual overrides, and lifecycle status. Editing an instance never mutates the normalized source snapshot or the master template.

For live data the dependency direction is `SalesforceClient -> AscendixReportAdapter -> ReportDataService -> normalized schema -> generation engine`. Both HTTP and MCP call the same `ReportDataService`; neither contains Salesforce mapping or metric calculations.

## Data flow

1. The wizard creates a `ReportGenerationRequest`.
2. The selected provider returns only its own source content, metadata, provenance, and section-completeness declarations.
3. Strict normalization enforces rates, non-negative metrics, signed absorption, and request period/market consistency.
4. Central calculations use the explicit calculation universe and attach formula/input lineage.
5. Reconciliation preserves conflicts unless an explicit authorized override resolves them.
6. Readiness evaluates template requirements, provenance, and publication blockers.
7. The presentation adapter formats values and removes unavailable or fixture-only template content.
8. Repeaters expand only the independently selected detail pages.
9. A versioned `ReportInstance` snapshot opens for draft editing; approval and publishing remain gated by readiness.
10. Preflight and deterministic renderers produce pages in document order.

The generation stages (`loading`, `normalizing`, `calculating`, `reconciling`, `validating`, `building-presentation`, `expanding`, and `creating`) correspond to real execution boundaries.

## CI architecture

Vitest owns `src/**/*.test.ts(x)` through `vitest.config.ts`; Playwright owns `tests/visual/**/*.spec.ts(x)` through `playwright.config.ts`. `scripts/check-test-ownership.mjs` enforces the naming/location contract without shell globs so Windows and Linux discover the same tests. GitHub's `Quality / validate` job runs install, Chromium setup, typecheck, Vitest, build, visual regression, and failure-artifact upload.

## Security boundary

Credentials never belong in the browser. The Ascendix adapter intentionally requires a server endpoint. Before production, protect report and asset APIs with organizational SSO, authorization, tenant isolation, audit logging, encrypted persistence, and signed object-storage access.

## Target production services

- PostgreSQL for templates, immutable template versions, report instances, jobs, and provenance
- S3-compatible object storage for uploaded assets and rendered artifacts
- Authenticated job queue/workers for Chromium rendering
- Organization SSO/OAuth and role-based access
- Ascendix/Salesforce service integration with server-managed credentials

The current local API, LocalStorage persistence, and disk asset store are development implementations of these boundaries.
