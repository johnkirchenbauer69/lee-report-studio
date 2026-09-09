# Production Safety Phase 1C

Phase 1C hardens existing report persistence, artifact integrity, Salesforce,
publication, and narrative architectures. It does not change report formulas,
template ownership, or the Phase 1A/1B storage model.

## Reproduced failure modes

- `SalesforceRestClient` cached a SOAP/OAuth session forever. An authenticated
  401 failed the query permanently, while `health()` reported `connected: true`
  merely because the stale session object existed.
- reconciliation QA rendered `reconciliation.details.records[].propertyId`
  directly, and the presentation-model boundary excluded provenance/source
  notes from its recursive Salesforce-ID assertion.
- historical `deliveredSf` and `salesVolume` aggregation converted absent
  Salesforce values to zero; marketing chart bar arrays also used
  `numberAt(...) ?? 0`. Line rendering joined points across absent quarters.
- export preflight entered image validation only when `element.src` was truthy,
  and `/api/render/pdf` did not perform image readiness checks.
- crop and table-edit IDs were independent of page/artifact navigation.
- external narrative generation created the remote MCP job before writing any
  local ownership state. Async browser intervals and server polls could overlap,
  and a repeated completed batch could append duplicate revisions.
- API callers independently defaulted to port 8787, so an explicit base URL was
  not one authoritative configuration.

## Salesforce reauthentication and health

All authenticated REST operations use one request wrapper. A Salesforce 401
invalidates only the session that failed, starts one shared authentication
promise using the configured auth strategy, and retries that request once.
HTTP 400, 403, and 5xx responses do not trigger authentication. The wrapper
never switches between SOAP login and client credentials and never logs tokens
or credentials.

`GET /api/integrations/salesforce/health` now performs an authenticated
`/services/data/v{version}/limits/` probe. The backward-compatible `configured`
and `connected` fields remain, with `status` (`configured`, `authenticated`,
`degraded`, or `failed`), auth mode, safe instance hostname, API version, last
successful Salesforce request, last health check, and last auth refresh. Report
data success is separately named `lastSuccessfulReportRequestAt`.

Salesforce binary image reads are isolated from JSON REST reads through a
dedicated Node `http`/`https` transport. It uses a fresh connection, requests
identity encoding, consumes the complete response, and closes the socket. The
existing authenticated wrapper still owns the session, API-call accounting,
single-flight refresh, and one retry after a 401. JSON responses discarded by
that retry and the successful health-probe response are explicitly consumed.

## Client-facing Salesforce ID safety

`looksLikeSalesforceId`, `containsSalesforceIdToken`,
`sanitizeSalesforceDisplayValue`, and `sanitizeSalesforceClientPayload` define
the shared boundary. Report Data Service stores the unsanitized authoritative
snapshot internally, then recursively sanitizes the API result. Presentation
models and QA source notes receive the same recursive sanitation. Reconciliation
uses the property/address context and displays `Property Data record` when no
safe property identifier exists. Server error display strings are sanitized as
well.

## Null versus zero

Historical delivered-area and sales-volume rollups now produce `undefined` when
any required source member is absent; an explicit source zero remains `0`.
Marketing bar renderers omit missing bars, label the position `Unavailable`, and
exclude missing values from domains. Line renderers split into contiguous
segments instead of interpolating across a missing quarter. Narrative facts
normalize non-finite/absent metrics to `value: null` and
`displayValue: "Unavailable"`; actual zero retains its zero formatting. The SVG
contract is shared by browser and PDF rendering.

## Publication image preflight

Visible images are publication-required by default. `publicationRequired:
false` is the explicit opt-out for a legitimate optional placeholder; hidden
images are not published. Shared structural preflight blocks blank/missing
sources and missing managed assets. Browser preflight continues to decode image
content and validate MIME type. Final `/api/render/pdf` requests repeat
structural and content checks server-side and return HTTP 422 with
`MISSING_REQUIRED_IMAGE` or `UNRESOLVED_IMAGE_ASSET`. A caller may explicitly
request `renderMode: "draft"` for a non-final proof path; no proof UX is added.

The Q2 live acceptance investigation identified Node's bundled Undici parser
as the source of the fatal `Parser.finish` assertion. The server-side image
preflight used `GET` only to inspect response headers and left every image body
unread. Under repeated large image checks, socket closure could find the parser
paused under backpressure and terminate the process. Metadata checks now use
`HEAD`, so no response body is created or abandoned. Repeated image bindings
are also resolved during page expansion; a genuinely empty repeated data slot
is marked optional for that generated instance, while every non-empty source
remains required and MIME-validated.

## Transient editor state

One transient scope key combines document mode, artifact identity, and page ID.
When it changes, crop, image replacement, table/cell editing, page drag, context
menu, snap guides, and in-progress pointer history are reset. Durable document
state and undo/redo history are retained. Escape exits crop first, then table
editing, before broader selection behavior.

## Narrative generation, polling, and import safety

Generate All first writes a `creating` reservation and generated idempotency key
through the per-report repository queue. Only the reservation owner creates the
MCP job; same-process callers share one start promise and other callers reuse the
persisted active state. The key is passed to the MCP as `idempotency_key` and is
retained locally. Remote creation failure transitions the reservation to a
retryable `failed` state with `NARRATIVE_JOB_CREATE_FAILED`.

External states are `creating`, `waiting_for_chatgpt`, `importing`, `complete`,
`failed`, and `expired`. Browser polling self-schedules only after each request
settles. Server polling is single-flight per report. Completed imports store a
SHA-256 input fingerprint; an identical repeat is a no-op with no report
revision, while a different batch for the completed job is rejected.

At startup, process-local narrative records left in `generating` and external
reservations left in `creating` transition to a recoverable failed state. An
`importing` external job remains recoverable because the remote completed batch
is polled and imported again idempotently. Approved narratives and stale-context
validation remain unchanged.

## API base URL

`src/shared/apiBaseUrl.ts` is the canonical resolver. Precedence is explicit
function/constructor argument, `LEE_API_URL`, same-origin, then the local
development default. It normalizes trailing slashes and preserves configured
base paths. AscendixDataProvider and all Q2/narrative acceptance scripts use the
same resolver; tests assert an explicit custom host/port never falls back to 8787.

## Deferred work

Report Library, stable report routes, page navigator redesign, proof-PDF UX,
validation workflow redesign, narrative approval UX, Inspector/design-system
work, accessibility expansion, asset-browser UX, version history/conflict merge
UI, and distributed multi-writer storage remain post-1C work.
