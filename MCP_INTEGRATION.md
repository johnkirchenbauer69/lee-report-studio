# MCP Integration

The backend exposes an official Model Context Protocol Streamable HTTP endpoint at `http://127.0.0.1:8787/mcp`. It uses the TypeScript MCP SDK's per-request handler. Local development runs over loopback; production places this endpoint behind HTTPS and organizational access controls.

Set an independent `MCP_API_KEY` and send `Authorization: Bearer <key>`. Production refuses MCP requests when the key is absent. MCP authentication is separate from the backend's Salesforce integration identity; callers cannot submit or forward Salesforce tokens.

## Semantic tools

- `get_market_report_data` — calls `ReportDataService.getIndustrialMarketReport` and returns validated data, completeness, conflicts, and a snapshot.
- `validate_report` — runs the deterministic readiness engine against an existing snapshot.
- `get_report_conflicts` — reads conflict/reconciliation state already stored in provenance.
- `get_report_provenance` — reads source and calculation lineage for a field in a snapshot.
- `get_report_service_status` — returns safe mode, connectivity, definition, and capability metadata.

The intentionally deferred `create_market_report` tool will be added when report-instance persistence is durable enough to return stable report IDs. This sprint implements the correct read/validate subset rather than a second or transient generation engine.

There are no tools for arbitrary SOQL, Apex, object mutation, or unrestricted Salesforce access. MCP tools never calculate authoritative metrics and do not write to Salesforce.

The MCP and HTTP paths consume the same verified Salesforce normalization, exclusion, contributor-ranking, completeness, provenance, and immutable snapshot logic. Authentication credentials and field-probe details never enter tool inputs or responses; only safe capability diagnostics may appear in service metadata.

## Stable workflow

Call `get_market_report_data` once, then use its snapshot ID for validation, conflict, and provenance operations. This prevents conversational steps from observing different live source states. Models may summarize, explain, or draft narrative from service output, but official metrics must come from the deterministic service.

Development and production both use Streamable HTTP. A local stdio wrapper can be added later without changing tool handlers because `ReportMcpTools` is transport-neutral.
