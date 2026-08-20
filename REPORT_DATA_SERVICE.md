# Shared Report Data Service

`ReportDataService` is the authority for live industrial-market data. HTTP and MCP handlers validate/serialize requests but do not query Salesforce, map fields, calculate metrics, or infer publishability themselves.

```text
ReportDataRequest
  -> Salesforce client
  -> Ascendix adapter and centralized field map
  -> strict normalization
  -> scoped deterministic cross-checks
  -> provenance/conflict reconciliation
  -> section completeness
  -> Zod schema validation
  -> immutable snapshot + canonical SHA-256
  -> ReportDataResult
```

## Contract

The input is UI-independent: report type, market, period, calculation scope, optional requested sections, and an explicit historical/current time context. If omitted, time context becomes `historical-period` for the requested period.

The result contains the strict `IndustrialMarketReport`, source metadata, completeness, definition version, request/record-count metadata, and `{ id, hash }` for the source snapshot. `industrial-market-report-data-v1` identifies the query/mapping rules used.

The SHA-256 is integrity/change-detection metadata over a recursively key-sorted canonical report payload. It is not a signature, timestamp authority, or complete cryptographic audit system.

## Snapshots

The current `InMemoryReportSnapshotStore` clones on save/read, rejects duplicate IDs, and is replaceable through `ReportSnapshotStore`. `GET /api/report-snapshots/:id` retrieves a snapshot while the process remains alive. Production needs a durable database/object store and retention policy.

Each Ascendix-generated `ReportInstance` records the source snapshot ID/hash and definition version. Editing presentation pages does not mutate the source snapshot. A future **Refresh from Salesforce** command must create a new snapshot and explicitly offer adoption; it must not overwrite the old snapshot or silently destroy manual edits.

## HTTP

- `POST /api/report-data/industrial-market`
- `GET /api/report-snapshots/:id`
- `GET /api/integrations/salesforce/health`

Example:

```json
{
  "market": "Chicago",
  "period": "2026 Q2",
  "calculationScope": { "type": "all-submarkets" },
  "timeContext": { "type": "historical-period", "period": "2026 Q2" }
}
```

No response is completed from a fixture unless `REPORT_DATA_MODE=mock` was selected explicitly (or the non-production local default was left in place).
