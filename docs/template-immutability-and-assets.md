# Template immutability and asset integrity

This document defines the Phase 1B persistence contract for master templates,
managed assets, and generated reports.

## Artifact contract

- A draft template is mutable, saveable, versionable, and deletable when it is
  not the template's only remaining version.
- A published or archived template is immutable. It remains selectable and can
  generate reports, but editor mutations are rejected. Changes begin with a new
  draft version.
- A generated `ReportInstance` remains presentation-editable through the
  revision-aware Phase 1A document-patch path. Its generated pages, data
  snapshot, source identity, and source checksum are frozen at generation time.
  Opening or exporting it does not require the source template file to exist.

## Published-template mutation boundary

The editor derives one `documentMutable` permission with
`canMutateDocument(mode, templateStatus)`. Every document change reaches the
central `mutate` dispatcher, including pointer updates that intentionally do
not create a history record. Permission and undo-history recording are separate
decisions.

For published and archived templates, the dispatcher refuses page, element,
style, table, chart, guide, asset, group, union, and clipboard mutations.
Undo/redo are also refused. Inspector controls are made inert and the header
labels the artifact `Published — Read Only` or `Archived — Read Only`.
Selection and viewing remain available. The template repository independently
rejects direct attempts to save a non-draft version.

`Create New Version` copies the immutable version to a draft with a new version
number. That successor is editable; the source record and checksum do not
change.

## Managed-asset reference model

`AssetReferenceIndex` rebuilds dependencies when a delete is requested. It
reads every persisted template version and `ReportInstance`, then recursively
walks canonical persisted pages. It recognizes explicit `assetId` and
`fontAssetId` fields and Studio URLs of the form
`/api/assets/:id/content`. This covers image elements, logos represented as
images, page/background URLs, nested table/chart typography, repeated pages,
and generated report pages. A report's explicit managed-font references are
also included.

Template `assets` arrays are inventories, not proof of use. The application
hydrates each template with the shared server asset inventory, so treating
inventory membership as a reference would make every uploaded asset
undeletable. Persisted page usage and managed-font pins are the authoritative
reference boundary.

The current filesystem repositories are small. A deletion scan is
`O(template document bytes + report document bytes)`. It is deterministic and
has no cache to become stale. A rebuildable persisted index may replace it if
repository scale makes this cost material.

A shared in-process integrity coordinator serializes template/report writes
with the dependency-scan-and-delete operation. A reference therefore cannot be
persisted between a successful scan and byte removal in the running API
process. Deployments with multiple API writer processes would require a
distributed lock or a transactional external repository before horizontal
write scaling.

## Deletion policy and API

`DELETE /api/assets/:id` is enforced server-side.

- An unreferenced asset is hard-deleted and returns `204`.
- An asset referenced by any draft, published/archived template, or report is
  retained and returns `409 Conflict`.
- A failed dependency scan or malformed repository/asset metadata fails the
  request; deletion never proceeds from an empty fallback.

The conflict body is machine-readable and does not include report content:

```json
{
  "code": "ASSET_IN_USE",
  "assetId": "asset-id",
  "referenceCount": 3,
  "references": {
    "draftTemplates": [
      {
        "artifactType": "draft-template",
        "artifactId": "template-id",
        "version": "1.2.0"
      }
    ],
    "publishedTemplates": [],
    "archivedTemplates": [],
    "reportInstances": []
  }
}
```

The browser keeps the asset in its local list after a conflict and displays the
server message. Existing managed-font checksum, approval, retirement, and
publication checks remain in force.

Asset IDs are generated UUIDs. Imported bytes are content-addressed by SHA-256
storage keys, and there is no endpoint that overwrites bytes under an existing
asset ID. Referenced asset identity is therefore stable.

## Report source-template independence

Generated pages already contain all report layout, element content, bindings,
and styles. `dataSnapshot`, `templateId`, `templateVersion`,
`templateChecksum`, source snapshot identifiers, and managed-font references
already preserve report data and provenance. Phase 1B adds the smallest missing
immutable metadata snapshot:

```ts
sourceTemplateSnapshot?: {
  name: string;
  settings?: EditorSettings;
}
```

New reports restore directly from this compact metadata plus their own pages.
They do not fetch the source template. Managed assets are still shared,
immutable resources and are protected from deletion by the reference index.
No separate asset manifest is stored because canonical generated pages plus
`fontReferences` already provide a complete deterministic manifest for the
current schemas.

Deleting a source draft is safe after report generation. Provenance continues
to name its template ID, version, and checksum, while the report remains
reopenable and exportable.

## Backward compatibility

`sourceTemplateSnapshot` is optional, so `ReportInstance.schemaVersion`
remains `1`. Existing valid records are not rewritten when read. For a legacy
report without the field, restore uses the source template when available. If
that template is missing, the editor logs
`source_template_missing_during_report_restore` and reconstructs the document
from persisted report pages with safe default editor settings. It does not
forget the report ID or invent business content.

The dependency scanner also infers legacy report assets directly from their
generated pages and `fontReferences`. A missing referenced asset remains a
validation/rendering problem; it is never replaced with unrelated content.

## Structured integrity logs

The server emits `asset_delete_blocked`, `asset_delete_allowed`, and
`asset_dependency_scan_failure` with operation, asset ID, and safe counts or
error names. Logs never include narratives, Salesforce records, credentials,
or other report data.

## Deferred work

Phase 1B intentionally does not add garbage collection, a retirement UI, a
Report Library, source-session refresh, image missing-source preflight, crop or
table transient-state persistence, narrative job changes, page navigation,
proof PDF, broad UI polish, accessibility work, or iconography changes.
