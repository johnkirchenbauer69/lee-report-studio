# Report Data Model

`src/report-engine/schema/industrialMarketReport.ts` defines the product-owned Zod contract. Providers must produce this model before presentation or template code can consume data.

## Principles

- Numeric business values remain numbers; formatting is a presentation concern.
- Source-system field names never appear in visual bindings.
- Additive metrics and weighted rates are calculated centrally.
- Every known disagreement can carry source references, authority, status, and notes.
- An approved visible exception is stored in `presentationOverrides`; it does not replace normalized data.
- A generated `ReportInstance` snapshots the validated data and template version used at generation time.

## Main sections

- `report`: identity, market, period, template, and preparer
- `overallMarket`: calculated market metrics and approved narrative
- `submarkets`: row-level inventory, construction, absorption, vacancy, availability, rents, and sales
- `historicalPeriods`: time-series market indicators
- `leasing`, `sales`: top transaction records
- `availabilities`, `deliveries`, `construction`: property highlights and assets
- `provenance`: field-level source reconciliation records
- `presentationOverrides`: explicit approved display exceptions

## Formatting

`formatReportValue` is the only business-value formatting boundary. Templates receive presentation values for integer, decimal, percentage, currency, square-foot, and rent formats. Calculation code must never parse formatted strings.

## Manual edits

Manual editor changes belong to `ReportInstance.manualOverrides`, with the element ID, binding path, generated value, replacement value, and timestamp. This keeps source truth, approved presentation exceptions, and user editing distinguishable.
