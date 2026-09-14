# ChatGPT narrative generation over the LEE Intelligence MCP

Report Studio remains the production and review interface. ChatGPT becomes the
narrative reasoning and writing runtime, reached through the existing remote
LEE Intelligence MCP. There is one generation workflow and no provider picker.

## Why there is a handoff at all

A standalone browser application cannot silently run a logged-in ChatGPT model
session, and the remote MCP cannot call back into a Report Studio server
running on an analyst's own machine — `http://127.0.0.1:8787` means "this
machine" to whoever resolves it. So the governed narrative context is parked on
the MCP in the middle, and every hop is outbound:

```
browser  ->  Report Studio API  ->  NarrativeMcpBridgeClient  ->  remote /mcp
ChatGPT  ->  remote /mcp   (reads the job, writes narratives, submits the batch)
browser  ->  Report Studio API  ->  NarrativeMcpBridgeClient  ->  remote /mcp
```

Clicking **Generate All Narratives** creates the job, opens the configured
ChatGPT app, copies a one-line handoff, and starts polling. It does not itself
run inference. The analyst never exports or imports JSON.

## Configuration

```text
NARRATIVE_GENERATION_MODE=chatgpt_mcp          # or direct_model
NARRATIVE_MCP_URL=https://api.ascendixmcp.com/mcp
NARRATIVE_MCP_CHATGPT_APP_URL=                 # optional; opened on the click
NARRATIVE_MCP_POLL_MS=1500
```

`OPENAI_API_KEY` is **not** required for the normal workflow. Under
`chatgpt_mcp`, generation is configured when the remote MCP is reachable *and*
all four narrative job tools are present:

- `create_report_studio_narrative_job`
- `list_pending_report_studio_narrative_jobs`
- `get_report_studio_narrative_job`
- `submit_report_studio_narrative_batch`

The Narratives banner reads **"ChatGPT narrative generation is ready."** when it
is, and **"LEE Intelligence MCP narrative bridge is unavailable."** when it is
not. Manual editing and approval remain available either way.

`OpenAINarrativeModelClient` and `MockNarrativeModelClient` are retained for the
`direct_model` mode and for deterministic CI.

## Health

```text
GET /api/integrations/narrative-mcp/health
```

Returns `configured`, `reachable`, `mcpUrl`, `toolCount`, `requiredToolsFound`,
`missingTools`, `checkedAt`, and `error`. It never returns credentials. The
server also checks the bridge once at startup and logs the result.

## What Generate All sends

Only publication-safe context leaves the process. Each market's
`NarrativeContext` is rebuilt, passed through `publicNarrativeContext()` —
which strips server-only `internalSourceIds` and throws on any raw Salesforce
identifier — and sent with job metadata, prompt versions, and any editorial
instruction. The full `ReportInstance` is never sent.

Every job carries `output_contract_version: "narrative-v2"`. Every public
context carries the same `outputContractVersion` and a governed
`promptProfile`. Overall Market targets 225–325 words across 3–5 short
paragraphs with a 375-word hard maximum; submarkets target 160–230 words across
2–4 short paragraphs with a 275-word hard maximum. Paragraph counts are
editorial guidance, while the hard word maximum is enforced. There is no
single-paragraph requirement.

The complete per-market submission shape is `marketId`, `narrative`, `claims`,
`contextKeysUsed`, `qualityFlags`, and `promptVersion`. Every claim requires
`claim`, `supportKeys`, and `evidenceClass` (`direct`, `derived`, or
`interpretive`). The current quality flags are
`limited_driver_context`, `limited_transaction_context`,
`interpretive_statement`, `numeric_validation_warning`,
`entity_validation_warning`, `template_opening`, `batch_repeated_opening`,
`metric_dump`, `repetitive_sentence_structure`, `boilerplate_phrasing`, and
`missing_comparative_context`.

The canonical machine-readable artifact is
`contracts/report-studio-narrative-contract-v2.json`. A regression test compares
it with the runtime schema, profiles, and market registry. The MCP pins the
same artifact and rejects unknown versions, so a future incompatible change
cannot silently fall back to old rules.

Approved and edited narratives are held back by default, so a batch can never
silently overwrite reviewed work. Per-market Generate/Regenerate uses the same
job mechanism with `generation_scope: "selected"` and a single market.

## Import: local validation stays authoritative

When the job completes, Report Studio imports it through `NarrativeService`,
never by mutating JSON in React. For every returned narrative it:

1. rebuilds that market's **current** local `NarrativeContext`;
2. compares `contextHash` against both the hash recorded when the job was
   created and the hash the remote reports — a mismatch means report data moved
   while ChatGPT was writing, so the market is marked **stale** for
   regeneration rather than imported;
3. checks the prompt version matches the current profile;
4. re-runs `validateNarrativeResult()`: support-key grounding, numeric support,
   named-entity support, raw Salesforce identifiers, and hard word limits.

The entity check treats digits and slashes as part of a name, because real
markets are called `I-55 Corridor` and `I-80/Joliet Area`. A class that
excluded them truncated `I-55` to `I-` and rejected correct prose.

**Import is atomic.** If any requested market fails — unknown market, duplicate
market, missing market, stale context, prompt mismatch, or a validation error —
nothing is imported, existing narratives are untouched, and the panel shows
"ChatGPT returned a batch that failed Report Studio grounding validation." That
avoids a mixed quarter where some markets reflect current data and others do
not. The analyst can retry.

A rejected batch usually still sits on the MCP until its TTL expires, so
**Retry Import** re-runs the import against the same job
(`POST /report-instances/:id/narratives/external-job/reimport`). A grounding
fix does not require another ChatGPT round trip.

Successful records become ordinary Draft `NarrativeRecord`s with
`source: "ai"`, `model: "chatgpt-mcp"`, the locally verified `contextHash`, the
returned claims, `contextKeysUsed`, and quality flags. Revision history,
staleness, approval, overflow blocking, and the evidence panel are unchanged.

`model` is `chatgpt-mcp` rather than a specific model name: ChatGPT does not
expose which model wrote the batch through this workflow, and inventing one
would be a false provenance claim.

## Runtime job state

`ReportInstance.externalNarrativeJob` (never the master template):

```ts
{
  provider: "chatgpt_mcp";
  jobId: string;
  status: "creating" | "waiting_for_chatgpt" | "complete" | "failed" | "expired";
  createdAt: string; updatedAt: string;
  marketIds: string[];
  generationScope: "all" | "selected";
  appUrl?: string; handoffPrompt?: string; expiresAt?: string;
  importedAt?: string; error?: string; instruction?: string;
  contextHashes?: Record<string, string>;
}
```

## Polling

The browser polls only the local server:

```text
GET /api/report-instances/:id/narratives/external-job
```

which polls the remote MCP and imports the batch as soon as it is available.
The browser never implements an MCP session.

ChatGPT's verified sequence is GET job -> generate every requested market ->
SUBMIT one complete batch -> GET the same job again. It must see
`status: "complete"` and matching `expected_narratives` /
`accepted_narratives` before representing the job as complete. Successful
submit and readback include empty `missing_market_ids` and
`rejected_market_ids`; domain failures carry stable error codes and actionable
market-level metadata. MCP SDK/Zod input-shape failures remain distinguishable
as protocol input-validation errors.

## Testing

```bash
npm test                        # includes bridge client + external generation
npm run test:visual             # includes the full handoff against a mock MCP
npm run narrative:bridge:acceptance
```

`narrative:bridge:acceptance` is the deterministic cross-repository acceptance:
create a job, read it back over MCP, submit a grounded batch, poll, import,
approve all 19, render the 44-page PDF — with no `OPENAI_API_KEY` and no model
call. It starts an in-process mock MCP by default; set
`NARRATIVE_BRIDGE_ACCEPTANCE_MCP_URL` to run the same flow against a real LEE
Intelligence MCP.

## Development security note

The narrative job bridge is **intentionally unauthenticated** during
development: no connector authentication, no job ownership, no workspace
scoping, and non-durable in-memory job storage on the MCP side. Anyone who
knows a job id can read its context and submit its batch. Connector
authentication, authorization, job ownership, and durable storage are required
before production use.
