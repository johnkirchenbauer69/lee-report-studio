# Data Providers

All providers implement `ReportDataProvider` and return a validated `IndustrialMarketReport`. `providerRegistry.ts` is the only provider-selection boundary used by generation.

## Sample

The deterministic Q2 fixture contains the approved reference dataset, assets, reconciliation notes, and presentation overrides. It supports demonstrations, tests, and visual baselines.

## JSON

Accepts a JSON payload matching the normalized schema. Zod errors are converted to actionable field-path messages. This is the preferred interchange format for upstream systems that can already normalize their data.

## Excel

Excel v1 locates headers in the supplied Q2 Submarket Table workbook, maps cells to semantic fields, and records sheet/cell references as provenance. It uses the Q2 fixture for report sections absent from that workbook. It is intentionally not a generic spreadsheet inference engine; new workbook layouts require an explicit mapping/version.

Workbook parsing uses `exceljs`, loaded only when an Excel import is requested. The dependency audit has no high/critical findings; its remaining moderate transitive `uuid` advisory concerns name-based UUID buffer handling, a code path this importer does not invoke.

## Ascendix

The Ascendix provider is a server-only adapter boundary. It refuses direct browser credential usage and expects a configured backend endpoint to return normalized JSON. Production work still includes authentication, pagination, retries, source-record identifiers, mapping tests, and operational monitoring.

## Adding a provider

1. Implement `ReportDataProvider.loadReportData(request)`.
2. Map source DTOs to raw semantic values.
3. Attach field-level provenance where available.
4. Validate with `industrialMarketReportSchema`.
5. Register the provider and add contract/error tests.

Provider code must not format values, construct template elements, or silently replace source conflicts.
