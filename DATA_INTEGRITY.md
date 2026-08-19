# Data Integrity Guarantees

LEE Report Studio treats missing or disputed data as visible report state, never as an invitation to substitute convenient content.

## Production guarantees

1. **Production providers never use sample fixtures.** Only the explicit `sample` provider may load the approved Q2 reference dataset. JSON, Excel, and Ascendix outputs are isolated to their configured source.
2. **Missing values remain missing.** Every dataset section declares completeness. Empty sections remain empty, fixture-only template artwork is removed, and the editor displays an unavailable state.
3. **Every imported critical metric is traceable.** Production metrics require a source reference and import timestamp. Excel records workbook/sheet/cell; JSON records file/JSON path; Ascendix records endpoint response paths until durable object/record IDs are available.
4. **Conflicts are never silently resolved.** A critical `conflict` remains a publication blocker until an explicit reconciliation or authorized override exists.
5. **Presentation overrides are explicit and auditable.** Overrides require field path, value, authority, reason, and creation time, with an optional source reference. They do not mutate normalized source values.
6. **Calculation scope is independent from page selection.** Overall metrics use the declared analytical universe. Choosing detailed pages cannot implicitly change market totals.
7. **Cross-period and cross-market contamination is blocked.** Request period/market must match normalized source metadata, and production page snapshots are scanned by regression tests for fixture-only values.

## Validation and readiness

Normalized numeric fields are raw numbers. Rates must be between 0 and 1; business quantities are non-negative except net absorption, which may be negative. Validation issues use `info`, `warning`, `error`, and `blocking` severity. Draft editing can continue with missing required data, but approval and publication cannot.

Template `requiredSections` and `optionalSections` define publication expectations. The Q2 Overall Market template requires overall metrics, submarkets, historical indicators, leases, and sales. Its highlight and narrative sections remain optional unless a future template version promotes them.

## Test matrix

- Complete Q2 sample report and approved four-page visual regression
- Partial Excel import with calculated overall metrics and missing other sections
- Synthetic Q3 Excel import with no Q2 fixture leakage
- Invalid rate rejection and valid negative absorption
- Unresolved conflict draft/publication behavior
- Authorized override reconciliation
- Full-market calculation with independently selected detail pages
- JSON, Excel, and Ascendix provider isolation

## Known audit status

The current dependency audit reports **0 critical, 0 high, and 2 moderate** advisories. Both flow through `exceljs -> uuid@8.3.2` and concern name-based UUID v3/v5 buffer handling. The Excel importer does not call that affected path; ExcelJS uses UUID v4 for a conditional-formatting identifier. No non-breaking upstream fix is presently available, so the risk is documented and should be rechecked on dependency upgrades.
