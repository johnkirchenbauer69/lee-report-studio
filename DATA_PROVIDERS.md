# Data Providers

All providers implement `ReportDataProvider` and return a validated report envelope: normalized data, provider identity, source metadata, and section completeness. `providerRegistry.ts` is the only provider-selection boundary used by generation.

Only the `sample` provider may import the approved fixture. JSON, Excel, and Ascendix providers must derive their output solely from their configured source. Missing source sections remain empty and explicitly missing; provider code must never use plausible fixture content as a substitute.

## Sample

The deterministic Q2 fixture contains the approved reference dataset, assets, reconciliation notes, and presentation overrides. It supports demonstrations, tests, and visual baselines.

## JSON

Accepts only the supplied JSON payload. Missing completeness declarations are inferred from that payload, critical metrics receive JSON-path/file/timestamp provenance, and Zod errors become business-readable field messages.

## Excel

Excel v1 locates headers in a Submarket Table workbook, maps cells to semantic fields, and records workbook/sheet/cell/import-time provenance. It calculates overall values from those rows. All other sections are empty and marked missing. It is intentionally not a generic spreadsheet inference engine; new workbook layouts require an explicit mapping/version.

The workbook layout does not expose trustworthy report-period metadata. The request supplies market and period metadata, and the workbook name remains attached to every imported value so the limitation is visible and auditable.

Workbook parsing uses `exceljs`, loaded only for Excel import. The current audit is exactly 0 critical, 0 high, and 2 moderate advisories through `exceljs -> uuid@8.3.2`. The vulnerable v3/v5 name-based UUID buffer code is not used by this importer; ExcelJS references UUID v4 for conditional-formatting identifiers. There is currently no non-breaking upstream remediation.

## Ascendix

The browser's Ascendix provider is a thin client for `POST /api/report-data/industrial-market`. It accepts only the strict service envelope and carries snapshot metadata into the `ReportInstance`; it contains no Salesforce credentials, mappings, calculations, or fixture fallback.

The backend chooses the explicit mock or Salesforce Ascendix adapter. Live queries are controlled and mapped through one configuration module. The service adds cross-check lineage, completeness, definition version, and an immutable hash-addressed snapshot before returning data. See `SALESFORCE_INTEGRATION.md` and `REPORT_DATA_SERVICE.md`.

## Adding a provider

1. Implement `ReportDataProvider.loadReportData(request)`.
2. Map source DTOs to raw semantic values.
3. Attach field-level provenance for imported critical metrics.
4. Declare every dataset section complete, partial, missing, or not requested.
5. Validate with `industrialMarketReportSchema`.
6. Register the provider and add isolation, contract, and error tests.

Provider code must not import a different provider's fixture, format values, construct template elements, or silently replace source conflicts.
