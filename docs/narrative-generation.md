# Narrative generation architecture

LEE Report Studio creates one Overall Market narrative and one narrative for
each of the 18 canonical Chicago industrial submarkets. Narrative prose belongs
to a generated `ReportInstance`; the v1.8.0 master template remains layout-only.

## Data flow and authority

The server-side Report Data Service remains the only source of official report
metrics. The Narrative Context Builder receives that normalized snapshot and
adds only quarter-scoped, publication-safe context produced by the existing
Ascendix/Salesforce adapter and contributor pipeline. `Market_Data__c` values
remain authoritative; supporting property and transaction records are
explanatory and cannot overwrite headline metrics.

The model receives a compact serialized context packet after the application
has calculated deltas, rankings, and formatted display values. It receives no
Salesforce, MCP, web-search, or function tools. Internal Salesforce provenance
IDs remain on the server and are removed before the prompt or client evidence
panel is created. Leases are included only when confidentiality is explicitly
`false`; `true` and unknown values are excluded.

## Materiality rules

The context builder applies deterministic caps before inference:

- absorption contributors: up to 5 positive and 5 negative;
- leases, sales, availabilities, construction, and deliveries: up to 5 each;
- Overall Market leaderboards: top 3 and bottom 3 per ranked metric;
- history: the current period plus up to 4 preceding quarters.

Records are sorted by the relevant governed size, price, contribution, or
metric before the caps are applied. Stable ordinal support keys such as
`lease.1` and `driver.absorption.positive.1` identify the resulting facts
without exposing source IDs.

## Generation mode

`NARRATIVE_GENERATION_MODE` selects how the Generate buttons produce prose.
This is an internal mode, never a user-facing provider picker: there is one
generation workflow.

`chatgpt_mcp` (default) hands the governed contexts to ChatGPT through the
remote LEE Intelligence MCP and imports the batch it submits back. No
`OPENAI_API_KEY` is required, and generation is considered configured when the
remote MCP is reachable and all four narrative job tools are present. See
[CHATGPT_NARRATIVE_BRIDGE.md](CHATGPT_NARRATIVE_BRIDGE.md).

`direct_model` uses the in-process client below. It is retained for CI and
future use.

## Direct model configuration

The direct-model client uses the OpenAI Responses API and strict Structured
Outputs through the official Node SDK. The default model is
`gpt-5.6-terra`, selected for the balance of writing quality and cost, and can
be changed with `OPENAI_NARRATIVE_MODEL`. `OPENAI_API_KEY` is read server-side
only. Requests set `store: false` and expose no model tools.

`NARRATIVE_GENERATION_CONCURRENCY` defaults to 3. The deterministic mock is
enabled only when `NARRATIVE_MODEL_PROVIDER=mock`, which is intended for local
acceptance and CI.

## Governance

Generated prose starts as `draft`; manual changes become `edited`. Publication
requires every narrative to be `approved`, current, successful, and within its
rendered text box. Each record stores its prompt version, context SHA-256,
report-data hash, claims, support keys, quality flags, timestamps, revision
history, model, and token usage when available. A changed context hash marks the
record `stale` without deleting its text.

The post-generation validator rejects unknown support keys, unsupported named
entities, Salesforce IDs, hard-limit overflow, and unrelated numeric claims. It
runs identically on prose written in-process and on a batch imported from
ChatGPT: Report Studio re-derives each market's current context and re-validates
before anything becomes a Draft record.
Plausible but ambiguous rounding is retained as an explicit review warning.
Chromium performs the final text-fit measurement in the actual template boxes
before publication PDF output.

Prompt profiles are versioned as `overall-market-v1` and `submarket-v1`.
Changing a future prompt profile does not alter or reapprove existing prose.

## Acceptance commands

```text
npm run narrative:acceptance:q2
npm run narrative:acceptance:q2:live
npm run narrative:bridge:acceptance
```

The first command uses live Q2 2026 Report Data Service data with the
deterministic mock model and exercises all 19 narratives. The second is opt-in
and calls OpenAI only when `OPENAI_API_KEY` is configured; by default it samples
Overall Market and representative submarkets. Set
`NARRATIVE_ACCEPTANCE_ALL=1` to exercise all 19 with the live model.

`narrative:bridge:acceptance` covers the ChatGPT/MCP path end to end: create a
narrative job, read it back over MCP, submit a grounded batch, poll, import,
approve all 19, and render the 44-page PDF — with no `OPENAI_API_KEY` and no
model call.
