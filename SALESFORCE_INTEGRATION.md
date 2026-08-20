# Salesforce / Ascendix Integration

## Security and authentication

Salesforce access exists only in the Node backend. The browser and MCP callers receive normalized report data and never receive an OAuth token, client secret, private key, or refresh token.

The production-preferred flow is OAuth 2.0 client credentials through a dedicated Connected App and read-only integration user. Local development may explicitly select `SALESFORCE_AUTH_MODE=soap-login` and use `SF_USERNAME`, `SF_PASSWORD`, `SF_SECURITY_TOKEN`, and `SF_DOMAIN=login|test`. A failed selected strategy is fatal; the client never tries the other strategy.

The integration identity should have API access and read-only field/object permissions for the mapped report objects. It needs no Salesforce write, Apex execution, metadata-administration, or user-impersonation permissions.

## Modes and failure behavior

- `REPORT_DATA_MODE=mock` uses the deterministic Q2 fixture and is intended only for development and CI.
- `REPORT_DATA_MODE=salesforce` constructs the live adapter. Missing credentials fail during startup. Authentication, query, missing-record, and schema errors fail the request; there is no fallback to mock/sample data.
- Production requires `REPORT_DATA_MODE` to be explicitly set.

The safe health endpoint is `GET /api/integrations/salesforce/health`. It reports mode, configuration/connectivity state, definition version, and last successful request time without exposing an org token or credential.

## Verified Industrial Market Report Salesforce Contract

All API names live in `server/integrations/ascendix/salesforceFieldMap.ts`. Registry statuses distinguish `verified-production-dashboard`, `verified-live-org`, `verified-derived`, and `optional-probed`.

Initial object roles are:

| Object                       | Report use                                                    |
| ---------------------------- | ------------------------------------------------------------- |
| `Market_Data__c`             | Historical aggregate, submarket, and period metrics           |
| `Market_Data_Contributor__c` | Period-frozen historical highlight selection and ranking      |
| `ascendix__Lease__c`         | Direct lease enrichment/current support; `Off_Market_Date__c` |
| `ascendix__Sale__c`          | Direct sale enrichment/current support; Sale Date preferred   |
| `ascendix__Availability__c`  | Availability enrichment/current support                       |
| `ascendix__Property__c`      | Property address/type/owner/image enrichment                  |
| `Property_Data__c`           | Eligible 20K+ historical property-quarter universe            |

`Quarter_Label__c` is authoritative for historical identity; `2026Q2`, `2026 Q2`, and `Q2 2026` canonicalize to `2026 Q2`. Raw Salesforce percentage points become internal decimal ratios exactly once at ingestion. Narrative remains blank because no authoritative `Market_Data__c` narrative field is established.

## Live-Verified Chicago Industrial Report Contract

- A quarter contains exactly the canonical 18 Chicago `Market_Data__c` submarket snapshots. Q2 2026 has no stored Overall Market row, and its `Market__c` values are null; retrieval therefore uses `Quarter_Label__c + accepted Submarket__c`.
- Standard submarket headlines and trends retain official `Market_Data__c` authority.
- Current-quarter Overall Market headlines roll up all eligible `Property_Data__c` rows in the accepted universe, including zero-inventory and otherwise-eligible unlinked rows. Vacancy and availability use ratio-of-sums.
- Historical Overall Market trends aggregate the 18 `Market_Data__c` snapshots by quarter.
- Quarterly Net Absorption comes from `Market_Data__c.Total_Net_Absorption_SF__c` for a standard submarket and `SUM(Property_Data__c.Net_Absorption_SF_Total__c)` across the approved eligible universe for the current Overall Market headline. It drives the Overall Market Table and quarter-specific narrative.
- Market Indicators **12 Month Net Absorption (SF)** is never read as a separate stored overall value. For each target quarter, the adapter first aggregates the requested geography's quarterly Market_Data records, then takes the signed sum of the target and prior three quarters. Missing history remains `null`/`insufficient_history`; provenance lists all four periods and contributing record IDs.
- Contributors are stored per submarket. Overall Market pools the accepted 18 sets and globally ranks them; a standard submarket scopes contributors to that submarket and validates the Market_Data parent.
- Frozen contributor-native values precede linked live enrichment. Only missing finalist fields are enriched in at most four batched source-object queries.
- Speculative construction is `verified-derived`: `Under_Construction_Available_SF__c / Under_Construction_SF__c`, and Overall Market uses ratio-of-sums. Zero construction produces `0`, never NaN/Infinity.
- The live Q2 QA exceptions remain explicit: one eligible Chicago South Property_Data row is unlinked, and West Cook linked Property_Data inventory exceeds official Market_Data by 82,000 SF. Neither silently replaces or invalidates official West Cook data.
- `ascendix__Property__c.Full_Address__c` is not assumed. Historical contributor `Address__c` is preferred; component address fields are used only when enrichment is necessary.

Optional contributor relationships are probed independently. A field-level permission failure omits only that enrichment and appears in source diagnostics.

## Local configuration and checks

```powershell
Copy-Item .env.example .env
# Edit .env with REPORT_DATA_MODE=salesforce and one explicit auth group.
git check-ignore -v .env
npm run salesforce:check
npm run salesforce:benchmark:q2
```

The check prints only connectivity, auth mode, safe instance hostname, API version, and object/field capability. The benchmark compares the live Chicago 2026 Q2 snapshot with the approved fixture without printing records or secrets.

## Historical and current rules

`historical-period` requests preserve the source hierarchy above. Property_Data/Market_Data differences are retained as reconciled source-definition comparisons instead of being treated as automatic corruption.

`current` is a separate request type. The adapter currently rejects it clearly until the live current-state mapping has been verified; it cannot accidentally take the historical path.

Every Salesforce metric records record ID, object/field reference, retrieval time, and authority. Calculated cross-checks add formula and input lineage. Quarterly and trailing-12-month net absorption use distinct normalized field paths and metric types, so `5,206,811` and `17,654,829` are valid simultaneous Q2 Overall Market values rather than a conflict. Structured logs include request ID, market, period, mode, record counts, duration, result, and snapshot ID—never credentials.
