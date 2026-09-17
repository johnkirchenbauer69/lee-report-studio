import { describe, expect, it } from "vitest";
import type { NarrativeContext, NarrativeGenerationResult, NarrativeContextFact } from "../../src/report-engine/narratives/schema.ts";
import { validateNarrativeResult } from "./validation.ts";

/**
 * Regression coverage for the structured governed-entity resolution
 * hierarchy (Deliverable 2). Models real Q3 2026 governed address and
 * company patterns: extracted street-suffix fragments of a full governed
 * address (e.g. "Youngs Rd" from "3835 Youngs Rd") must resolve without a
 * warning, while genuinely hallucinated or mismatched entities must still
 * warn.
 */

const fact = (
  contextKey: string,
  entityNames: string[],
  overrides: Partial<NarrativeContextFact> = {},
): NarrativeContextFact => ({
  contextKey,
  category: "lease",
  label: "Transaction",
  value: null,
  displayValue: "",
  sourceType: "Market_Data_Contributor__c",
  authority: "finalist",
  publicationSafe: true,
  entityNames,
  ...overrides,
});

const GOVERNED_ADDRESSES = [
  "3835 Youngs Rd",
  "325 State Rt 31",
  "1401 N Kirk Rd",
  "2550 Logistics Dr",
  "2300 Warrenville Rd",
  "3900 Finley Rd",
  "7701-7711 S Claremont Ave",
  "4401 W Ogden Ave",
  "2217 S Loomis St",
];

const GOVERNED_COMPANIES = [
  "Hyundai Translead",
  "UGL Truck",
  "McMaster-Carr",
  "XPress Global Systems",
  "Central National-Gottesman",
];

const context: NarrativeContext = {
  marketId: "overall",
  marketName: "Chicago Industrial",
  marketKind: "overall",
  period: "2026 Q3",
  promptVersion: "overall-market-v2",
  contextHash: "hash",
  facts: [
    ...GOVERNED_ADDRESSES.map((address, index) =>
      fact(`lease.${index + 1}`, [GOVERNED_COMPANIES[index % GOVERNED_COMPANIES.length]!, address]),
    ),
  ],
};

const resultFor = (narrative: string): NarrativeGenerationResult => ({
  narrative,
  claims: [{ claim: narrative, supportKeys: ["lease.1"], evidenceClass: "direct" }],
  contextKeysUsed: ["lease.1"],
  qualityFlags: [],
});

const entityIssues = (narrative: string) =>
  validateNarrativeResult(context, resultFor(narrative)).issues.filter(
    (issue) => issue.kind === "entity",
  );

describe("structured governed-entity resolution", () => {
  it.each([
    ["Youngs Rd", "3835 Youngs Rd"],
    ["State Rt", "325 State Rt 31"],
    ["Kirk Rd", "1401 N Kirk Rd"],
    ["Logistics Dr", "2550 Logistics Dr"],
    ["Warrenville Rd", "2300 Warrenville Rd"],
    ["Finley Rd", "3900 Finley Rd"],
    ["Claremont Ave", "7701-7711 S Claremont Ave"],
    ["Ogden Ave", "4401 W Ogden Ave"],
    ["Loomis St", "2217 S Loomis St"],
  ])("does not warn on street fragment %s from governed %s", (fragment) => {
    const narrative = `The property near ${fragment} saw strong activity this quarter.`;
    expect(entityIssues(narrative)).toEqual([]);
  });

  it.each(GOVERNED_COMPANIES)("does not warn on governed company %s", (company) => {
    expect(entityIssues(`${company} signed a new industrial lease this quarter.`)).toEqual([]);
  });

  it("resolves a full street-suffix-normalized address (Road vs Rd)", () => {
    expect(entityIssues("Activity was concentrated near 3835 Youngs Road this quarter.")).toEqual([]);
  });

  it("resolves the CNG alias for Central National-Gottesman", () => {
    expect(entityIssues("CNG expanded its footprint this quarter.")).toEqual([]);
  });

  // --- Negative controls: must still warn ---------------------------------

  it("warns on a hallucinated company absent from context", () => {
    expect(entityIssues("Definitely Fake Industries signed a new lease.").length).toBeGreaterThan(0);
  });

  it("warns on a hallucinated address", () => {
    expect(entityIssues("Strong demand was reported near 9999 Nonexistent Way.").length).toBeGreaterThan(0);
  });

  it("warns on a hallucinated city", () => {
    expect(entityIssues("Fictional City saw the largest gains this quarter.").length).toBeGreaterThan(0);
  });

  it("warns on a hallucinated transaction/project name", () => {
    expect(entityIssues("The Imaginary Logistics Park delivered this quarter.").length).toBeGreaterThan(0);
  });

  it("does not silently resolve a similar-but-distinct address (1401 S Kirk Rd vs governed 1401 N Kirk Rd)", () => {
    const issues = entityIssues("The lease closed at 1401 S Kirk Rd this quarter.");
    expect(issues.length).toBeGreaterThan(0);
  });

  it("does not let a city name substring-match inside an unrelated company name", () => {
    const cityContext: NarrativeContext = {
      ...context,
      facts: [
        ...context.facts,
        fact("driver.1", ["Chicago Heights Fabricators LLC"], { category: "market_driver" }),
      ],
    };
    // "Chicago Heights" alone must not be silently accepted just because it
    // is a substring of a governed company name that happens to contain it
    // — it is not itself an address-like fragment (no house number, no
    // street-suffix token), so containment resolution must not apply here.
    const issues = validateNarrativeResult(
      cityContext,
      resultFor("Chicago Heights posted strong absorption this quarter."),
    ).issues.filter((issue) => issue.kind === "entity");
    expect(issues.length).toBeGreaterThan(0);
  });

  it("keeps ambiguous ungrounded fragments as warnings with unsupported_entity provenance", () => {
    const issues = validateNarrativeResult(
      context,
      resultFor("Definitely Fake Industries signed a new lease."),
    ).issues.filter((issue) => issue.kind === "entity");
    expect(issues[0]?.entityProvenance?.resolutionMethod).toBe("unsupported_entity");
  });
});
