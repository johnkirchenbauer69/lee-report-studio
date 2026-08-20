# Report Data Model

## Live-Verified Chicago Industrial Report Contract

The standard definition uses 18 quarter-specific `Market_Data__c` rows and has no stored Overall Market row. Standard submarket metrics remain official Market_Data snapshots. Overall current-quarter metrics come from the accepted `Property_Data__c` `Eligible 20K+ Market Universe`; historical trends aggregate Market_Data by quarter. Contributor cards retain their `Market_Data_Contributor__c` parent/quarter/submarket/source IDs and prefer frozen native display values before finalist-only enrichment. Snapshot metadata records headline, trend, and contributor source definitions plus Salesforce call counts.

Live Ascendix datasets also carry a service envelope containing source metadata, completeness, and an immutable source snapshot `{ id, hash }`. Generated Ascendix `ReportInstance` records reference that ID/hash plus `reportDefinitionVersion`; presentation edits do not change the source snapshot. See `REPORT_DATA_SERVICE.md`.

`src/report-engine/schema/industrialMarketReport.ts` defines the product-owned Zod contract. Providers must produce this model before presentation or template code can consume data.

## Principles

- Numeric business values remain numbers; formatting is a presentation concern.
- Source-system field names never appear in visual bindings.
- Additive metrics and weighted rates are calculated centrally.
- Every known disagreement can carry source references, authority, status, and notes.
- An approved visible exception is stored in `presentationOverrides`; it does not replace normalized data.
- Every dataset section declares `complete`, `partial`, `missing`, or `not-requested` with its source IDs.
- Production-imported critical metrics require source references and import timestamps; calculated metrics carry formula and input lineage.
- Calculation scope defines the analytical universe independently from detailed-page selection.
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
- `dataCompleteness`: explicit status and source ownership for every report section

## Semantic constraints

Rates are raw decimals from 0 through 1. Inventory, construction, deliveries, rent, transaction amounts, and property sizes are non-negative. Net absorption is intentionally signed. Cross-field anomalies such as availability below vacancy, zero rent, or rates on zero inventory are surfaced as warnings rather than silently corrected. `deliveredSf <= inventorySf` is not enforced because workbook timing and metric definitions can differ.

## Provenance and overrides

Imported provenance includes source ID/type, reference, timestamp, authority, and status. Derived overall metrics add a formula, input paths, and input count. A conflict remains unresolved until a presentation override supplies a non-empty authority, reason, value, and creation timestamp. Critical unresolved conflicts block approval and publication.

## Request and readiness

`ReportGenerationRequest.calculationScope` selects all or explicitly named submarkets for overall calculations. `pageSelection.submarkets` independently controls repeating detail pages. `ReportReadiness` exposes `canEdit`, `canExportDraft`, `canApprove`, `canPublish`, issues, and blockers. Draft editing remains possible for incomplete imports, while missing required sections and critical conflicts block approval/publication.

## Formatting

`formatReportValue` is the only business-value formatting boundary. Templates receive presentation values for integer, decimal, percentage, currency, square-foot, and rent formats. Calculation code must never parse formatted strings.

## Manual edits

Manual editor changes belong to `ReportInstance.manualOverrides`, with the element ID, binding path, generated value, replacement value, and timestamp. This keeps source truth, approved presentation exceptions, and user editing distinguishable.
