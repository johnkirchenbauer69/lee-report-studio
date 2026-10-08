# Narrative Context v3

Narrative Context v3 changes how Report Studio prepares AI market narratives.
Report Studio stops guessing at economic causes. It consumes governed
explanatory facts from the Market Data Engine, curates them into a richer
context, and tells the model what the reader already sees on the page.

## Ownership boundary

Report Studio owns context assembly, editorial selection, prompt behavior,
narrative validation, page awareness, and layout and font sizing.

The Market Data Engine owns the following:

- explanatory bridge math, such as vacancy, availability, and absorption bridges
- the driver taxonomy
- materiality and evidence strength
- leasing-to-occupancy timing
- construction start and delivery changes

Report Studio never derives a cause. The only Report Studio calculations are
deterministic editorial facts over governed data: breadth counts,
inflections, transaction materiality, formatting, and page awareness. If the
engine supplies a breadth measure, Report Studio does not recalculate it.

## What changed from v2

**Shallow causal inference was removed.** v2 produced a `market_driver` fact
saying a vacancy increase was "associated with second-generation space
returning" whenever vacancy rose and any negative-absorption contributor
existed. It produced the mirror-image claim for falling vacancy. Both are gone.

When no governed driver exists, the context states only the movement. A
deterministic divergence fact supports the acceptable fallback:

```text
Vacancy rose 50 basis points to 6.0% despite positive quarterly net absorption of +120,000 SF
```

Property-level absorption contributors (`driver.absorption.*`) remain, but they
are labeled as components of net absorption (`analyticalType: "materiality"`,
`causalSupport: false`). They never explain vacancy or availability.

## Upstream contract: market-explanation-v1 Contributor rows

The authoritative upstream contract is the Market Data Engine's
`market-explanation-v1` (`market_explanations.py`, `explanation_snapshots.py`).
The engine reuses the existing `Market_Data_Contributor__c` schema. Report
Studio requires no new Salesforce field.

The adapter (`server/integrations/ascendix/explanatoryContributors.ts`) maps
the six additive explanation categories:

| `Contributor_Category__c` | `factType` | Rank basis |
| --- | --- | --- |
| Vacancy Increase Driver | `vacancy_bridge` | Quarter-over-quarter vacancy SF change |
| Vacancy Reduction Driver | `vacancy_bridge` | Quarter-over-quarter vacancy SF change |
| Availability Increase Driver | `availability_bridge` | Quarter-over-quarter availability SF change |
| Availability Reduction Driver | `availability_bridge` | Quarter-over-quarter availability SF change |
| Pipeline Start Driver | `pipeline_change` | Quarterly Construction Start SF |
| Pipeline Delivery Driver | `pipeline_change` | Quarterly Delivery SF |

These categories are excluded from every existing Contributor section. Before
this change, the legacy token fallback would have read "Availability Increase
Driver" as a Top Availability and "Pipeline Delivery Driver" as a Top Delivery.

Field roles:

| Field | Role |
| --- | --- |
| `Narrative_Context__c` | Publication-safe explanatory sentence. Becomes the fact's display value. |
| `Calc_Notes__c` | Versioned JSON evidence. Determines driver, evidence strength, values, materiality and provenance. |
| `Calculation_Version__c` | Must be `market-explanation-v1` when present. |
| `Rank_Basis__c`, `Rank__c`, `Metric_Value__c`, `Sort_Value__c`, `Display_Title__c`, `Display_Value__c` | Existing ranking and display fields. |
| `Active_In_Run__c`, `Included_In_Report__c` | Must be `TRUE`. |
| `Narrative_Eligible__c`, `Is_Deal_Confidential__c` | An explicit `FALSE` eligibility or `TRUE` confidentiality excludes the row. |

`Rank_Basis__c`, `Narrative_Context__c` and `Calc_Notes__c` were added to the
Contributor SOQL select list. They are existing fields the engine already
writes; they were simply not selected before.

`Calc_Notes__c` keys consumed when present (no category is assumed to have
every key):

- `version`, `driver_type`, `evidence_strength`, `metric`
- `prior_sf`, `current_sf`, `change_sf`
- `market_change_share_percent` for submarkets, `overall_change_share_percent` for the Overall Market
- `population_status`, `submarket_transfer`, `broker_effect`
- `construction_type`, `construction_type_source`
- `pipeline_event_sf`
- `timing_classification`, `availability_event`, `marketing_classification`, `removal_cause`, `direct_change_sf`, `sublet_change_sf`, `current_future_available_sf`, `current_available_now_sf`, `current_unknown_timing_sf`
- `prior_snapshot_provenance`, `prior_snapshot_hash`, `comparison_warnings`
- `evidence_ids`, kept only as a count. The identifiers are never retained.

**Parsing and fallback.** `Calc_Notes__c` is parsed only for the six
categories. A row of any other category, including plain-text legacy notes,
is never touched. An explanation row whose notes are missing, not JSON, not an
object, or not version `market-explanation-v1` is still published as a
measured change from `Narrative_Context__c`. It is marked `trusted: false`
with evidence `unspecified`, never licenses a cause, and adds a
publication-safe adapter diagnostic. One bad row never fails the query.

**Overall Market.** The Contributor query now includes
`Submarket__c = 'Overall Market'`. Overall Market explanation rows for the
report quarter populate `report.explanatoryFacts`. The canonical submarket
scoping still excludes those rows from every existing section. Report Studio
does not reconstruct an Overall Market causal bridge; it only adds
descriptive breadth, dispersion and inflection facts.

**Provenance.** `prior_snapshot_provenance`, such as
`versioned_authoritative` or `legacy_unversioned_authoritative`, along with
the snapshot hash and `comparison_warnings`, is preserved on each fact as
`explanationProvenance`. A legacy-unversioned prior quarter does not suppress
an explanation the engine marked ready.

**Construction type** comes from Property `ascendix__ExpansionType__c`
upstream and is kept verbatim. `Partial-Spec` and `Expansion` stay distinct.
`Unknown` is labeled not classified, and Report Studio never infers a type.

### Evidence strength and wording

Report Studio uses the engine's vocabulary verbatim: `confirmed`, `strong`,
`indicative`, plus `unspecified` where no governed strength exists.

| Evidence | `causalSupport` | Wording |
| --- | --- | --- |
| `confirmed` | true | The cause may be stated directly. |
| `strong` | true | The cause may be stated, without overstating certainty. |
| `indicative` | false | Measured movement only, with no cause attached. |
| `unspecified` or untrusted | false | Measured movement only. |

Causal support also requires a known driver type. `driver_type: unknown` and
`availability_removed`, which upstream marks as cause unknown, never license
a cause, whatever the strength. Driver links that promote a small
transaction into the narrative follow the same gate.

Leasing-to-occupancy timing is not published as a Contributor category in
`market-explanation-v1`. A lease counts as a move-in upstream only when it
commences in the quarter, so a future-commencing lease leaves the property's
change `unknown`. The `leasing_conversion`, `absorption_bridge`,
`materiality`, `market_breadth` and `market_driver` fact types remain in the
model for future governed sources, but nothing maps to them today.

### How explanatory facts are used

- Every fact keeps its transport `category` (`market_driver`) and adds
  `analyticalType` set to the fact type.
- Each label states the governed cause and its strength, or says it is a
  measured change only. Labels also carry construction type, availability
  timing, and submarket-reassignment notes.
- `materialityPercent` carries the engine's signed share, which can exceed
  100% or be negative when changes offset.
- `editorialBrief.causalCoverage` tells the model which movements have a
  governed explanation.

## Context model

Each fact keeps `contextKey`, `label`, `value`, `displayValue`, `authority`,
`publicationSafe`, and `entityNames`. Context v3 adds these optional fields:

| Field | Meaning |
| --- | --- |
| `analyticalType` | metric, trend, historical, inflection, ranking, lease, sale, availability, construction, delivery, count, composition, concentration, vacancy_bridge, availability_bridge, absorption_bridge, leasing_conversion, pipeline_change, materiality, market_breadth, market_driver |
| `editorialPriority` | `lead`, `supporting`, or `background` |
| `evidenceStrength` | `confirmed`, `strong`, `indicative`, or `unspecified` |
| `driverType`, `causalSupport` | Governed driver identity, and whether causal wording is licensed |
| `priorValue`, `currentValue`, `changeValue`, `materialityPercent` | Supplied where available |
| `visibleOn` | Page components that already print the value |
| `constructionType`, `explanationProvenance` | Governed construction type and upstream provenance |

The fact `category` stays inside the frozen narrative-v2 enum, because the
live MCP validates it.

### Editorial brief and page context

Every context carries an `editorialBrief`. It is hashed with the facts, so a
page-composition change re-stales the narrative.

- `pageContext` is derived from the generated pages. It covers the indicators
  table, trend charts, submarket table, Top Leases and Top Sales, property
  cards, and whether a detailed supply page follows. It is editorial
  metadata, not a market fact.
- `causalCoverage`, `marketActivity` (`quiet`, `moderate`, or `active`), and
  the v3 `editorialProfile`.
- `rules`: the core publication rules, so the ChatGPT path receives them too.

## Deterministic editorial facts

**Transaction materiality** replaces the plain top-five rule. A lease or sale
reaches the context only when a governed driver with confirmed or strong
evidence and a known cause names it, or when it scores at least 3 on this scale:

| Signal | Points |
| --- | --- |
| Named by a governed driver without a licensed cause | +1 |
| Rank #1 | +1 |
| Size of 500,000 SF+ (lease) or $100M+ (sale) | +3 |
| Size of 250,000 SF+ or $40M+ | +1 |
| Share of quarterly leasing or sales of 25%+ | +2 |
| Share of quarterly leasing or sales of 10%+ | +1 |

The caps are 4 for the Overall Market and 3 for a submarket. The Top Leases
and Top Sales tables are unchanged.

**Overall Market breadth** covers these measures across the 18 submarkets:

- absorption sign counts
- vacancy and availability direction counts
- top-3 share of gross positive absorption
- top-3 share of construction
- median submarket vacancy
- submarkets above and below overall vacancy
- vacancy and availability moving in opposite directions

**Inflections** cover these turning points:

- first positive or negative absorption quarter after a streak
- vacancy or availability direction reversal
- construction reactivation after a zero pipeline
- leasing acceleration or deceleration of 10% or more
- leasing and absorption versus the prior 4-quarter average

None of these project forward.

**Formatting:**

- $1B and above: `$1.19 billion`
- $1M to $999.9M: `$218.4 million`
- Asking rent: `$8.18/SF`

**Page-consistent values.** Headline metrics resolve through presentation
overrides exactly as the page does. The Overall sales volume equals the
Market Totals row, which is the sum of submarket sales volume. This fixes the
observed mismatch where the overall narrative cited the overall headline
while the table printed the submarket sum.

## Prompt v3 and profiles

The prompt asks for a market thesis led by the dominant story. It requires
governed causality, page awareness, and selective history and transactions.
It forbids forced conclusions, formulaic openings and closings, repeated
"while" contrasts, overused connective verbs, and em dashes. The rule that
the model may use only supplied governed context is unchanged.

| Profile | Target words | Hard max | Preferred paragraphs |
| --- | --- | --- | --- |
| `overall-market-v3` | 250–340 | 375 | 3–4 |
| `submarket-v3` | 175–240 | 275 | 2–3 |

Paragraph counts are guidance only. A submarket may use a third paragraph
only for a genuinely distinct subject: demand and occupancy, supply and
development, capital markets, or an unusually important leasing
concentration. Quiet markets are told not to pad.

## Editorial QA flags

These flags are advisory and never block a narrative. Report Studio computes
them locally and never accepts them from the generator.

| Flag | Meaning |
| --- | --- |
| `transaction_repetition` | Three or more named deals, or two that only restate the Top Leases or Top Sales table. |
| `weak_thesis` | The opening recites figures instead of stating a thesis. |
| `unsupported_outlook` | Forward-looking language with no governed pipeline or commencement support. |
| `excessive_metric_density` | More than 6 figures per 100 words, or 4 or more figures in one sentence. |
| `page_redundancy` | Recites 4 or more visible headline values (5 or more for the Overall Market). |
| `generic_closing` | A formulaic summary or positioning close. |
| `unsupported_causal_claim` | Causal wording with no governed driver in context. |

Existing QA continues unchanged: metric dump, repetitive structure (now
including repeated "while" contrasts), boilerplate (now including
underscoring, highlighting, reflecting, and signaling), opening checks,
comparative context, and numeric, entity, identifier, and support-key
validation.

## Dynamic narrative font sizing

The authored size is the hard minimum, and the maximum is +2 pt. The fit
works like this:

1. A binary search covers the nine 0.25 pt steps.
2. Each step measures the rendered text box. Line height and paragraph
   spacing are included because the box is measured, not estimated.
3. Enlargement keeps a 4% vertical safety margin.
4. Text that does not fit at the minimum keeps the authored size and is
   reported as overflow. It is never compressed or truncated.

The same `CanvasElement` code path runs in the editor preview and the Chromium
print page. The PDF renderer re-fits after managed fonts load and waits for
every narrative to settle. It reports overflow in the
`x-lee-narrative-overflow` response header. The editor persists measured
overflow to the narrative record, where the existing rules block approval and
publication. The fallback PDF renderer applies the same rule with its own
font metrics.

## Snapshot binding and staleness

Each narrative records `reportDataFingerprint`. This is a SHA-256 over the
provider snapshot hash, the data snapshot with narrative prose blanked, and
every data-bearing manual override.

A narrative becomes stale when its context hash or its fingerprint no longer
matches. This is checked on refresh, approve, direct-generation completion,
and batch import. External jobs record the snapshot hash and fingerprint at
creation, and import rejects the batch if either moved.

Export saves first, then refreshes staleness on the server, then builds the
PDF from that refreshed instance. Readiness blocks in three cases:

- The page would print text that differs from the reviewed narrative.
- A narrative-text manual override is present.
- An AI narrative is bound to a different provider snapshot.

Records created before this change have no fingerprint and keep
contextHash-only staleness.

## Required for the coordinated MCP narrative-contract v3 update

The transport stays on `narrative-v2`. The live MCP pins the category and
quality-flag enums, and it rejects any `promptProfile` that is not the v2
profile with `PROMPT_PROFILE_MISMATCH`. Public contexts therefore send the v2
`promptVersion` and `promptProfile`, and ChatGPT echoes the v2 version back.
The v3 profile, page context, causal coverage, and rules travel in the
additive `editorialBrief`. Import binds the narrative to the exact v3 context
through `contextHash`.

The MCP v3 release should do the following:

1. Accept `output_contract_version: "narrative-v3"` and pin
   `contracts/report-studio-narrative-contract-v3.draft.json`.
2. Accept the v3 profiles (`overall-market-v3` and `submarket-v3`) and their
   targets in `promptProfile`.
3. Surface `editorialBrief` (rules, page context, causal coverage, editorial
   profile) to ChatGPT as instructions, and replace the v2 guidance of 3–5 and
   2–4 paragraphs.
4. Optionally accept the seven editorial QA flags. Report Studio will still
   recompute them.
5. Optionally validate `analyticalType` and `evidenceStrength` enums on facts.

When that ships, switch `NARRATIVE_OUTPUT_CONTRACT_VERSION` to `narrative-v3`
and retire `NARRATIVE_TRANSPORT_PROMPT_PROFILES` in the same Report Studio
release.
