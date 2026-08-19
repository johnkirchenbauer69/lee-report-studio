# Architecture

## Product boundary

LEE Report Studio is a data-driven business document editor. It should emulate only the useful parts of a modern visual design application while making data binding, report generation, auditability and repeatability first-class concepts.

## Domain separation

### Source systems
Salesforce / AscendixRE objects and other future sources.

### Data service
Ascendix tools retrieve and calculate the authoritative metrics.

### Normalized report data model
A stable, product-owned schema that translates source-system complexity into report concepts such as `overall_market.vacancy_rate` and `market.top_leases`.

### Template schema
Versioned JSON that owns page dimensions, element geometry, visual styling, data bindings and component rules.

### Report instance
A snapshot produced from a template version + normalized dataset + generation parameters. Manual edits belong to the report instance, not the master template.

### Renderer
Produces browser output and ultimately deterministic server-side PDF output.

## Why the normalized report data model matters

A direct mapping such as `Market_Data__c.Some_Field__c -> visual element` creates a brittle template. The visual layer should bind to semantic fields instead. A mapping/adaptor layer can change as Salesforce changes without forcing template redesign.

## Suggested production stack

- Frontend: React + TypeScript
- Editor state: dedicated document store with command history
- Canvas: either enhanced DOM/SVG rendering or a mature canvas library after validating PDF fidelity
- API: Node/TypeScript or existing organizational backend
- Database: PostgreSQL for templates, versions, report instances, generation metadata
- Asset storage: S3-compatible object storage
- PDF: the current dedicated `pdf-lib` compositor provides deterministic multipage output; production should move the same schema renderer behind an authenticated job API and embed approved brand fonts
- Auth: organizational SSO / OAuth
- Ascendix: existing MCP/service boundary with a production HTTP/API adapter if required

## Current editor architecture

- `src/types/report.ts` owns the typed document, appearance, asset and editor-setting schemas.
- `src/engine/editorMath.ts` owns DPI conversion, fill rendering, snapping and distribution math.
- `src/engine/bindings.ts` remains the semantic data-resolution and formatting boundary.
- `src/engine/validation.ts` performs data, geometry, asset, gradient and estimated text-overflow checks.
- `src/services/persistence.ts` hides LocalStorage behind a replaceable persistence interface.
- `src/services/assetStorage.ts` talks to the disk-backed development asset API and provides an offline browser fallback.
- `src/services/pdfExport.ts` renders the ordered visible-page set directly from the schema into stable PDF bytes.
- `server/index.ts` exposes development upload/list/content/delete endpoints and persists an atomic asset manifest.
- `src/components/CanvasElement.tsx` renders document elements and localized pointer interactions.
- `src/components/Inspector.tsx` exposes unit-aware, type-specific property controls.
- `src/App.tsx` coordinates pages, selection, command history, assets, keyboard shortcuts and export.

All document geometry remains in CSS reference pixels. UI units are a presentation concern, converted with `96px = 1in`. Pointer interactions update rendering state continuously, while history captures a single transaction at pointer-up.

## Proposed entities

### Template
- id
- name
- report_type
- status
- current_draft_version

### TemplateVersion
- id
- template_id
- version
- schema_version
- document_json
- published_at
- published_by

### ReportInstance
- id
- report_type
- period
- market
- parameters_json
- template_version_id
- source_data_snapshot
- document_json
- status
- generated_at
- generated_by

### Asset
- id
- type
- storage_url
- metadata

### DataProvenance
- report_instance_id
- element_id
- binding_path
- source_object
- source_record_ids
- generated_value
- overridden_value

## Binding behavior

A binding should include semantic path, display format, fallback and eventually transform/conditional rules.

Example:

```json
{
  "path": "market.vacancy_rate",
  "format": "percentage",
  "decimals": 1,
  "fallback": "—"
}
```

## Repeating components

A component should have:

- `sourcePath`
- sort rule
- maximum items
- layout direction
- gap
- item template
- empty state rule

## Repeating pages

A page/page group should be generated from a collection such as `markets[]`, with a local binding context assigned for each iteration.

## Generation pipeline

1. Receive report parameters.
2. Query Ascendix/data services.
3. Normalize response.
4. Validate data contract.
5. Select a published template version.
6. Resolve global bindings.
7. Expand repeated components.
8. Expand repeated pages.
9. Apply conditional visibility and formatting.
10. Resolve images/assets.
11. Snapshot source data.
12. Create report instance.
13. Run QA checks.
14. Open report instance in editor.
15. Approve/export.

## Security

Never place Salesforce credentials in the browser. All Salesforce/Ascendix calls that require secrets should occur server-side. Treat report data as potentially confidential and support organizational access controls before production rollout.
