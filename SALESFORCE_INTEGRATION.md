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

All API names live in `server/integrations/ascendix/salesforceFieldMap.ts`. Registry statuses distinguish `verified-production-dashboard`, `verified-live-org`, `derived-unverified`, and `optional-probed`.

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

`Quarter_Label__c` is authoritative for historical identity; normalized bounds drive transaction dates. Percent scale correction happens before schema validation. The public universe centrally excludes Chicago North, I-39 Corridor, McHenry County, Other IL, Other IN, Other WI, and Rockford. The construction speculative-share candidate is derived from available/total under-construction SF but remains explicitly unverified. Narrative remains blank because no authoritative `Market_Data__c` narrative field is established.

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

`historical-period` requests query period-specific `Market_Data__c` records and preserve the stored historical aggregate as authority. The service cross-checks it against deterministic submarket totals and records matched/conflict provenance. It never rebuilds a past quarter from today's mutable Property or Availability state.

`current` is a separate request type. The adapter currently rejects it clearly until the live current-state mapping has been verified; it cannot accidentally take the historical path.

Every Salesforce metric records record ID, object/field reference, retrieval time, and authority. Calculated cross-checks add formula and input lineage. Structured logs include request ID, market, period, mode, record counts, duration, result, and snapshot ID—never credentials.
