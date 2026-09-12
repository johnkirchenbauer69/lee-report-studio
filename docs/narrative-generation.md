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
- leases, sales, availabilities, construction, and deliveries: up to 5 each
  for display, though `count` facts report the full quarter's governed
  record counts, uncapped;
- Overall Market leaderboards: top 3 and bottom 3 per ranked metric;
- history: the current period plus up to 4 preceding quarters for the
  recited period trend list, though QoQ/YoY/YTD/historical facts use all
  history the report snapshot carries.

Records are sorted by the relevant governed size, price, contribution, or
metric before the caps are applied. Stable ordinal support keys such as
`lease.1` and `driver.absorption.positive.1` identify the resulting facts
without exposing source IDs.

## Editorial context categories

Beyond the current-quarter `metric` facts, the context builder derives,
entirely deterministically, whatever the governed history and quarter
records support — nothing here is calculated by the model:

- **QoQ / YoY / YTD** (`trend` category, `metric.*.qoq_*` /
  `metric.*.yoy_*` / `ytd.*` keys): quarter-over-quarter and year-over-year
  changes (bps for rates, SF/percent for volumes), and year-to-date sums.
  YoY facts only appear when the same quarter one year prior is present in
  history; YTD facts only appear when every intervening quarter of the
  current year is present. Asking rent has no historical series in the
  governed schema, so no YoY figure is produced for it — this is a known
  gap, not a bug (see Limitations below).
- **Historical context** (`historical` category): highest/lowest value
  since the oldest period in the available lookback, consecutive
  positive/negative absorption streaks, consecutive vacancy/availability
  rising or falling streaks, trailing 4- and 8-quarter absorption averages,
  and current-quarter-vs-recent-average. Each gates on having enough
  history (3+ periods for extremes, 4/8 for averages) rather than
  fabricating a shorter comparison.
- **Counts** (`count` category): lease/sale/construction/delivery/
  availability counts for the quarter, from the full governed record set.
- **Construction composition** (`composition` category): speculative vs.
  built-to-suit SF, share, and project counts from the quarter's tracked
  construction records.
- **Leasing concentration** (`concentration` category): count and SF of
  500k-SF+ leases, and their share of the quarter's governed leasing
  activity SF (non-confidential leases only).
- **Rankings** (`ranking` category, Overall Market only): leader/laggard
  submarket leaderboards for absorption, vacancy, availability, under
  construction, and sales volume; a leasing-activity leaderboard is added
  only when every canonical submarket has a current-quarter leasing figure,
  so an incomplete population is never silently ranked.
- **Market drivers** (`market_driver` category): curated, deterministic
  explanation facts synthesized from governed records already present
  elsewhere in context — e.g. a vacancy increase paired with named
  negative-absorption contributors, or a construction pipeline dominated by
  built-to-suit SF. These exist so the model can attribute a result to a
  named cause without inferring causation from two merely-simultaneous
  facts; the prompt still requires an explicit driver fact before it may
  use strong causal language.

## Publication-safe entity sanitization

`src/shared/publicationEntitySafety.ts` runs (in addition to Salesforce-ID
stripping) on every tenant, buyer, developer, sponsor, and property label
before it reaches narrative context. It blanks bare internal placeholders
("TBD", "N/A", "Pending"), blanks values containing internal workflow notes
("waiting for comp," "internal note," "do not publish," …), and strips a
trailing CRM scratch suffix from an otherwise legitimate name ("Acme
Logistics - waiting for comp" → "Acme Logistics"). When a value cannot be
made safe with confidence, it is omitted rather than guessed at.

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
entities, Salesforce IDs, internal workflow language (Salesforce, Ascendix,
"waiting for comp," "finalist," support keys, provenance, …), markdown
bullets/headings, hard-limit overflow, and unrelated numeric claims. It runs
identically on prose written in-process and on a batch imported from ChatGPT:
Report Studio re-derives each market's current context and re-validates
before anything becomes a Draft record.
Plausible but ambiguous rounding is retained as an explicit review warning.
Chromium performs the final text-fit measurement in the actual template boxes
before publication PDF output.

The validator also runs pragmatic, non-blocking editorial QA heuristics and
records them as quality flags rather than rejecting stylistically varied
prose: `template_opening` (a formulaic "[Market] ended/closed/finished..." or
bare-metric opening), `batch_repeated_opening` (3+ markets in the same
generation batch share the same opening words — checked once per Generate
All / imported batch, in addition to the per-narrative check),
`metric_dump` and `repetitive_sentence_structure` (too many sentences read as
bare metric recitations), `boilerplate_phrasing` (overused connective
phrases), and `missing_comparative_context` (sufficient trend history existed
but the narrative made no comparative statement).

Prompt profiles are versioned as `overall-market-v2` and `submarket-v2`.
Changing a future prompt profile does not alter or reapprove existing prose.
Word/paragraph targets: Overall Market 225–325 words (375 hard max) across
3–5 short paragraphs; submarket 160–230 words (275 hard max) across 2–4 short
paragraphs. The prompt asks the model to identify the quarter's dominant
story, lead with it, select roughly 4–7 explanatory facts rather than a fixed
metric sequence, and vary its openings and sentence structure across markets.

## Known limitation

Asking net rent has no historical series in the governed `HistoricalMarketPeriod`
schema (only a current-quarter value), so a YoY asking-rent fact cannot be
derived without a Report Data Service schema change. It is omitted rather
than fabricated.

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
