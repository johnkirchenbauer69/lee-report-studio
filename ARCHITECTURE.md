# Architecture

## Product boundary

LEE Report Studio is a data-driven business document editor. Source retrieval, normalization, calculation, presentation reconciliation, template layout, report instances, and rendering are deliberately independent domains.

## Runtime layers

| Layer                | Primary location                                           | Responsibility                                                          |
| -------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| Source adapters      | `src/data-providers`                                       | Retrieve and normalize sample, JSON, Excel, or Ascendix data            |
| Report domain        | `src/report-engine/schema`                                 | Own strict semantic contracts and generation metadata                   |
| Calculations         | `src/report-engine/calculations`                           | Compute additive totals, weighted rates, and extrema from raw values    |
| Provenance           | `src/report-engine/provenance`                             | Preserve source choices, conflicts, and approved visible overrides      |
| Presentation adapter | `src/report-engine/bindings`                               | Format semantic data for template consumption                           |
| Generation           | `src/report-engine/generation`                             | Validate, expand repeaters, and create versioned report snapshots       |
| Template/editor      | `src/types`, `src/components`, `src/App.tsx`               | Own geometry, styling, manual overrides, and creative-tool interactions |
| Browser renderer     | `src/renderers/browser`                                    | Render fixed-size pages for editing, print, and visual tests            |
| PDF renderers        | `server/renderers`, `src/renderers/pdf`                    | Produce server Chromium PDFs or invoke the browser fallback             |
| Validation           | `src/report-engine/validation`, `src/engine/validation.ts` | Report-data validation plus export preflight                            |

## Report instance boundary

A generated report records the template ID/version, generation request, timestamp, normalized data snapshot, expanded pages, manual overrides, and lifecycle status. Editing an instance never mutates the normalized source snapshot or the master template.

## Data flow

1. The wizard creates a `ReportGenerationRequest`.
2. The provider registry selects a provider and validates the normalized result.
3. Central calculations produce totals and extrema from raw numeric fields.
4. Provenance records describe authorities, conflicts, and approved visible exceptions.
5. The presentation adapter applies formatting and approved overrides.
6. Repeaters expand page and component collections with contextual binding paths.
7. A versioned `ReportInstance` snapshot opens in the editor.
8. Manual element edits are recorded separately from generated values.
9. Preflight validates data, bindings, assets, fonts, geometry, and overflow.
10. The server loads the fixed print route and Chromium writes US Letter PDF pages in document order.

## Security boundary

Credentials never belong in the browser. The Ascendix adapter intentionally requires a server endpoint. Before production, protect report and asset APIs with organizational SSO, authorization, tenant isolation, audit logging, encrypted persistence, and signed object-storage access.

## Target production services

- PostgreSQL for templates, immutable template versions, report instances, jobs, and provenance
- S3-compatible object storage for uploaded assets and rendered artifacts
- Authenticated job queue/workers for Chromium rendering
- Organization SSO/OAuth and role-based access
- Ascendix/Salesforce service integration with server-managed credentials

The current local API, LocalStorage persistence, and disk asset store are development implementations of these boundaries.
