# Salesforce / Ascendix Integration

## Security and authentication

Salesforce access exists only in the Node backend. The browser and MCP callers receive normalized report data and never receive an OAuth token, client secret, private key, or refresh token.

The implemented production flow is OAuth 2.0 client credentials through a dedicated Salesforce Connected App and a dedicated read-only **LEE Report Studio Integration User**. Configure `SALESFORCE_LOGIN_URL`, `SALESFORCE_CLIENT_ID`, and `SALESFORCE_CLIENT_SECRET`. `SALESFORCE_INSTANCE_URL` and `SALESFORCE_API_VERSION` are optional. The username/private-key variables in `.env.example` reserve a future JWT bearer option and are not currently consumed.

The integration identity should have API access and read-only field/object permissions for the mapped report objects. It needs no Salesforce write, Apex execution, metadata-administration, or user-impersonation permissions.

## Modes and failure behavior

- `REPORT_DATA_MODE=mock` uses the deterministic Q2 fixture and is intended only for development and CI.
- `REPORT_DATA_MODE=salesforce` constructs the live adapter. Missing credentials fail during startup. Authentication, query, missing-record, and schema errors fail the request; there is no fallback to mock/sample data.
- Production requires `REPORT_DATA_MODE` to be explicitly set.

The safe health endpoint is `GET /api/integrations/salesforce/health`. It reports mode, configuration/connectivity state, definition version, and last successful request time without exposing an org token or credential.

## Object and field mapping

All API names live in `server/integrations/ascendix/salesforceFieldMap.ts`. The defaults are explicitly **unverified placeholders**, not claims about the live org. Each can be replaced through a documented environment mapping after Salesforce describe metadata or an administrator confirms the API name.

Initial object roles are:

| Object                       | Report use                                                      |
| ---------------------------- | --------------------------------------------------------------- |
| `Market_Data__c`             | Historical aggregate, submarket, and period metrics             |
| `Market_Data_Contributor__c` | Centralized future mapping for contributors/transaction support |
| `Lease__c`                   | Period-specific lease highlights                                |
| `Property_Data__c`           | Period-specific sale highlights                                 |
| `Availability__c`            | Period-specific availability cards                              |
| `Construction_Pipeline__c`   | Construction and delivered-property cards                       |

Before live rollout, verify every mapping, field-level permission, null convention, percentage scale, and market/period picklist value in a sandbox. Unverified mappings are surfaced by `unverifiedSalesforceMappings()`.

## Historical and current rules

`historical-period` requests query period-specific `Market_Data__c` records and preserve the stored historical aggregate as authority. The service cross-checks it against deterministic submarket totals and records matched/conflict provenance. It never rebuilds a past quarter from today's mutable Property or Availability state.

`current` is a separate request type. The adapter currently rejects it clearly until the live current-state mapping has been verified; it cannot accidentally take the historical path.

Every Salesforce metric records record ID, object/field reference, retrieval time, and authority. Calculated cross-checks add formula and input lineage. Structured logs include request ID, market, period, mode, record counts, duration, result, and snapshot ID—never credentials.
