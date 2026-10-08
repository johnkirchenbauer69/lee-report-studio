# Broker editorial policy review, Q3 2026

The only production change is the `BROKER_INTERVIEW_POLICY` string in `src/report-engine/narratives/brokerInterviews.ts`. Both `narrativePrompt` and `narrativeHandoffPrompt` already append that policy conditionally. No ingestion, sanitization, schema, publication filtering, support-key validation, numeric or causal validation, hashing algorithm, transport, or Salesforce behavior was changed by this task. Existing unrelated workspace changes were preserved.

The policy now requires the strongest governed thesis first; preservation of transaction explanations, history, drivers, and supply/demand analysis; optional enrichment of 0 to 3 sentences, generally one passage and less than approximately 25% of words; natural attribution once; direct observational prose; no evidence-methodology language or disclaimers; and supported natural contrast when sentiment differs from metrics. Existing authority, numeric, causal, publication-safety, market-isolation, and support-key requirements remain in the policy. No runtime phrase rejection was added.

## Comparison provenance and limitations

The before excerpts below are from the saved Q3 2026 report `server/data/report-instances/report-631c5190-a776-4acb-891c-f51c6bf10307.json`, generated through `chatgpt-mcp` on October 5, 2026. Its attached interview set is `Q3 Market Report Interviews .pdf`, SHA-256 `8da2f4fc1091964b7bbc595f32cb92a7f07e20d987d4832f5d7ad45c199f8d7a`. Only observations marked PUBLISHABLE were consulted.

The after passages are manually authored editorial examples grounded in that saved material, not regenerated model output, imported drafts, or publication-approved narratives. No local OpenAI API key is configured, and no hosted generation run was performed. Actual generated style acceptance remains outstanding. These examples avoid broker-only numeric ranges and unsupported causal verbs such as “pushing” or “steering.” Existing governed display values and claims must still be validated when full narratives are regenerated. The pre-enrichment draft was not identified conclusively, so analytical preservation here is assessed against the saved enriched draft and the user's benchmark.

## Fox Valley

Before: “Broker feedback adds a consistent qualitative layer to those results.” The passage ends by telling readers to treat the commentary as sentiment rather than a quantified supply conclusion.

After, full illustrative narrative:

Fox Valley recorded one of its strongest demand quarters in the recent series. Net absorption reached +709,371 SF, and leasing activity climbed to 1.3 million SF. Availability fell 241 basis points to 6.4%, while vacancy was essentially unchanged at 4.6%.

The McMaster-Carr Supply Company transaction was central to the quarter's demand profile. Its 543,603-SF lease represented a meaningful share of quarterly leasing, and the confirmed move-in at 1401 N Kirk Rd reduced vacant space by 543,603 SF. Development remained active, with 1.2 million SF under construction and no Q3 deliveries.

Our brokers are seeing stronger activity, particularly among mid-sized users. Landlords are showing more confidence in proposals as deals get done. Purchase options remain limited, and more users are considering build-to-suit opportunities.

Retained: absorption, leasing, availability movement, vacancy, material lease and confirmed occupancy driver, construction and deliveries. Broker passage: three sentences, approximately 24% of words.

## I-55 Corridor

Before: “That qualitative segmentation helps explain the competitive landscape without changing the governed vacancy and availability picture.”

After: “Our brokers are also seeing a clear split by product quality: tenants favor newer, higher-clear buildings, and landlords are getting more creative with incentives on older Class B and C space.”

Keep the governed discussion of +1.2 million SF absorption, the confirmed 400,400 SF move-in at 901 W Bluff Rd, Pioneer Technology's 577,442-SF new lease, and 2.5 million SF under construction. The insight is supported by the clear-height, concessions, and landlord-behavior observations.

## I-57 Corridor

Before: “Broker feedback is consistent with the transaction mix, pointing to stronger interest in big-box product and much slower activity in smaller buildings.”

After: “That concentration aligns with what our brokers are seeing, with the strongest activity in big-box requirements and much slower activity in smaller buildings.”

Keep the governed leasing concentration, the two DHL expansions, zero current-quarter absorption, measured vacancy and availability declines, and development pipeline. Integrate the sentence beside the concentration analysis rather than adding a broker-analysis paragraph.

## I-88 Corridor

Before: “Those observations fit a market where demand exists but is not evenly distributed across the inventory base.”

After: “Our brokers are seeing stronger activity among larger requirements, although the mid-sized segment remains softer. Clear height and power are also prominent tenant priorities.”

Keep the governed absorption and leasing improvement, higher vacancy and availability, named new availability, and limited construction pipeline. The insight uses tenant-activity, size-segment, clear-height, and power observations without repeating broker-only numeric ranges.

## North Kane

Before: “That qualitative view should be balanced against the governed Q3 data, which show vacancy moving modestly higher rather than continuing to tighten.”

After: “Our brokers continue to describe limited options in several size ranges and more leverage for landlords, although vacancy moved 34 basis points higher during the quarter. More tenants are looking west, with occupancy costs an important consideration.”

Keep the governed absorption, leasing, confirmed move-in, new availability, construction, and delivery discussion. The vacancy figure requires the existing governed support key in addition to broker support; the migration observation is not presented as an objective causal explanation.

## Northwest Cook

Before: “Broker feedback reinforces the subdued tone.” Later: “That commentary is consistent with a market where leasing velocity remains restrained and large-scale growth opportunities are limited.”

After: “Our brokers continue to see larger tenants bypassing Northwest Cook for locations farther west, while smaller users remain more location-sensitive. They describe limited development land and an inventory dominated by smaller flex buildings.”

Keep the governed quiet leasing thesis, positive absorption, divergent vacancy and availability movements, construction, and trailing absorption. Use the geography, inventory, and site-supply observations without asserting an unsupported causal effect on growth.

## O'Hare

Before: “Broker feedback adds nuance to the demand picture.” The passage ends: “The qualitative tone is more active, but still selective by size and transaction type.”

After: “Our brokers are seeing more activity in larger spaces after a quieter stretch, including more short-term leasing. Landlords are showing flexibility on term but continuing to hold rates.”

Keep the governed strong occupancy thesis, absorption history, vacancy and availability declines, confirmed move-ins, construction starts, and delivery. Use the publishable lease-term and landlord-behavior observations; retain no restricted deal details.

## West Cook

Before: “Broker feedback is consistent with a slower decision environment.”

After: “Our brokers are seeing slower tenant decisions, with many occupiers using their existing space before expanding. Landlords are pursuing limited deal flow more aggressively, although concessions have begun to shrink.”

Keep the governed negative absorption inflection after six positive quarters, lower leasing, higher vacancy and availability, construction start, and no deliveries. Use tenant-caution, market-velocity, landlord-behavior, and concessions observations without a methodological caveat or an added macro conclusion.

## Validation

- `npm test`: 95 files, 901 tests passed, including 11 new policy regressions and existing narrative grounding, broker ingestion, transport-shape, market-isolation, and no-broker context tests.
- `npx vitest run --config vitest.config.ts server/narratives`: 11 files, 232 tests passed.
- `npm run typecheck`: fails at `server/narratives/contextBuilder.ts:1945` because the parsed wire observation's `topic: string` is incompatible with `BrokerHandoffObservation`'s topic union. This is outside the policy-string change and was left unchanged to preserve the requested schema/transport scope.
- `git diff --check`: reports an existing blank line at EOF in untouched `server/narratives/contextBuilder.ts:1947`. The scoped check of the changed production policy file passes.
- No Salesforce writes, other repository edits, commits, merges, pushes, or deployment were performed.

The new tests cover both direct generation and handoff policy inclusion, governed-thesis preservation, sparse optional enrichment, natural attribution, direct phrasing, explicit prohibited-language guidance, no evidence disclaimers, supported contrast, unchanged grounding instructions, and unchanged no-broker prompts. They test instructions rather than claiming deterministic control over future model prose.
