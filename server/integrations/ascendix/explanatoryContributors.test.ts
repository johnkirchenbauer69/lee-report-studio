import { describe, expect, it } from "vitest";
import {
  contributorSection,
  MARKET_EXPLANATION_CATEGORIES,
  rankContributors,
} from "./contributors.ts";
import {
  mapExplanatoryContributors,
  MARKET_EXPLANATION_VERSION,
  overallMarketExplanationRows,
  parseExplanationCalcNotes,
} from "./explanatoryContributors.ts";

/**
 * Calc_Notes__c exactly as market-explanation-v1 publishes it:
 * json.dumps(canonicalize_value({version, **bridge_row, prior_snapshot_*,
 * comparison_warnings}), sort_keys=True).
 */
const calcNotes = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: MARKET_EXPLANATION_VERSION,
    property_id: "a0P000000000001AAA",
    property_name: "1053 N Schmidt Rd",
    submarket: "I-55 Corridor",
    construction_type: "Unknown",
    construction_type_source: "ascendix__ExpansionType__c",
    metric: "vacancy",
    prior_sf: 0,
    current_sf: 499200,
    change_sf: 499200,
    prior_inventory_sf: 1000000,
    current_inventory_sf: 1000000,
    population_status: "continuing",
    submarket_transfer: false,
    inventory_change_sf: 0,
    broker_effect: "negative",
    driver_type: "unknown",
    evidence_strength: "indicative",
    evidence_ids: [],
    measured_change_confirmed: true,
    prior_period_end: "2026-06-30",
    period_end: "2026-09-30",
    market_change_share_percent: 125.05,
    prior_snapshot_provenance: "versioned_authoritative",
    prior_snapshot_hash: "9f2c4b1e0d8a7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b",
    comparison_warnings: [],
    ...overrides,
  });

const row = (overrides: Record<string, unknown> = {}) => ({
  Id: "a0X000000000001AAA",
  Contributor_Category__c: "Vacancy Increase Driver",
  Quarter_Label__c: "2026 Q3",
  Submarket__c: "I-55 Corridor",
  Rank__c: 1,
  Rank_Basis__c: "Quarter-over-quarter vacancy SF change",
  Metric_Value__c: 499200,
  Sort_Value__c: 499200,
  Display_Title__c: "1053 N Schmidt Rd",
  Display_Value__c: "499,200 SF",
  Narrative_Context__c: "1053 N Schmidt Rd added 499,200 SF of vacant space from Q2 to Q3.",
  Calculation_Version__c: MARKET_EXPLANATION_VERSION,
  Calc_Notes__c: calcNotes(),
  Active_In_Run__c: true,
  Included_In_Report__c: true,
  ...overrides,
});

describe("market-explanation-v1 contributor categories", () => {
  it.each([
    ["Vacancy Increase Driver", "vacancy_bridge", "vacancy"],
    ["Vacancy Reduction Driver", "vacancy_bridge", "vacancy"],
    ["Availability Increase Driver", "availability_bridge", "availability"],
    ["Availability Reduction Driver", "availability_bridge", "availability"],
    ["Pipeline Start Driver", "pipeline_change", "construction"],
    ["Pipeline Delivery Driver", "pipeline_change", "construction"],
  ])("maps %s", (category, factType, metric) => {
    const { facts } = mapExplanatoryContributors([
      row({ Contributor_Category__c: category, Calc_Notes__c: calcNotes({ metric }) }),
    ]);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ category, factType, metric, trusted: true });
  });

  it("never lets an explanation category become an existing highlight section", () => {
    for (const category of MARKET_EXPLANATION_CATEGORIES)
      expect(contributorSection(category)).toBeUndefined();
    // Existing categories keep their sections, including the legacy fallback.
    expect(contributorSection("Availability")).toBe("availabilities");
    expect(contributorSection("Delivery")).toBe("deliveries");
    expect(contributorSection("Largest Lease")).toBe("leasing");
    const mixed = [
      row({ Contributor_Category__c: "Availability Increase Driver", Sort_Value__c: 9_000_000 }),
      row({ Contributor_Category__c: "Pipeline Delivery Driver", Sort_Value__c: 9_000_000 }),
      row({ Id: "legacy-availability", Contributor_Category__c: "Availability", Sort_Value__c: 100 }),
      row({ Id: "legacy-delivery", Contributor_Category__c: "Delivery", Sort_Value__c: 100 }),
    ];
    expect(rankContributors(mixed, "availabilities").map((item) => item.Id)).toEqual(["legacy-availability"]);
    expect(rankContributors(mixed, "deliveries").map((item) => item.Id)).toEqual(["legacy-delivery"]);
  });
});

describe("Calc_Notes__c parsing", () => {
  it("parses a valid market-explanation-v1 payload into the typed fact", () => {
    const { facts, diagnostics } = mapExplanatoryContributors([
      row({
        Contributor_Category__c: "Vacancy Reduction Driver",
        Metric_Value__c: -400000,
        Narrative_Context__c: "Warehouse p2 reduced 400,000 SF of vacant space from Q2 to Q3.",
        Calc_Notes__c: calcNotes({
          prior_sf: 400000,
          current_sf: 0,
          change_sf: -400000,
          broker_effect: "positive",
          driver_type: "tenant_move_in",
          evidence_strength: "confirmed",
          evidence_ids: ["l1:positive"],
          market_change_share_percent: -100.2,
        }),
      }),
    ]);
    expect(diagnostics).toEqual([]);
    expect(facts[0]).toMatchObject({
      explanationVersion: "market-explanation-v1",
      rankBasis: "Quarter-over-quarter vacancy SF change",
      displayValue: "Warehouse p2 reduced 400,000 SF of vacant space from Q2 to Q3.",
      value: -400000,
      driverType: "tenant_move_in",
      evidenceStrength: "confirmed",
      priorValue: 400000,
      currentValue: 0,
      changeValue: -400000,
      materialityPercent: -100.2,
      populationStatus: "continuing",
      submarketTransfer: false,
      brokerEffect: "positive",
      evidenceCount: 1,
      constructionTypeSource: "ascendix__ExpansionType__c",
      priorSnapshotProvenance: "versioned_authoritative",
    });
    // Evidence/source record identifiers are never retained.
    expect(JSON.stringify(facts)).not.toContain("a0P000000000001AAA");
    expect(JSON.stringify(facts)).not.toContain("l1:positive");
  });

  it.each(["confirmed", "strong", "indicative"])("keeps upstream evidence strength %s verbatim", (strength) => {
    const { facts } = mapExplanatoryContributors([row({ Calc_Notes__c: calcNotes({ evidence_strength: strength }) })]);
    expect(facts[0]?.evidenceStrength).toBe(strength);
  });

  it("maps an unrecognized strength to unspecified rather than inventing one", () => {
    const { facts } = mapExplanatoryContributors([row({ Calc_Notes__c: calcNotes({ evidence_strength: "moderate" }) })]);
    expect(facts[0]?.evidenceStrength).toBe("unspecified");
  });

  it("does not touch plain-text Calc Notes on legacy, non-explanation rows", () => {
    const legacy = row({ Contributor_Category__c: "Highest Vacancy", Calculation_Version__c: "mde-legacy", Calc_Notes__c: "Ranked by vacant SF; see run 42." });
    const result = mapExplanatoryContributors([legacy]);
    expect(result).toEqual({ facts: [], diagnostics: [] });
    expect(contributorSection("Highest Vacancy")).toBe("highestVacancy");
  });

  it("treats plain-text Calc Notes on an explanation row as untrusted measured change", () => {
    const { facts, diagnostics } = mapExplanatoryContributors([row({ Calc_Notes__c: "Vacancy up; see analyst." })]);
    expect(facts[0]).toMatchObject({ trusted: false, evidenceStrength: "unspecified" });
    expect(facts[0]?.driverType).toBeUndefined();
    expect(facts[0]?.displayValue).toBe("1053 N Schmidt Rd added 499,200 SF of vacant space from Q2 to Q3.");
    expect(diagnostics[0]).toMatch(/not valid JSON; treated as a measured change only/);
  });

  it("fails safe on malformed or mismatched explanation JSON without breaking other rows", () => {
    const result = mapExplanatoryContributors([
      row({ Calc_Notes__c: '{"version": "market-explanation-v1", "driver_type": ' }),
      row({ Contributor_Category__c: "Vacancy Reduction Driver", Calc_Notes__c: calcNotes({ version: "market-explanation-v0", evidence_strength: "confirmed", driver_type: "tenant_move_in" }) }),
      row({ Contributor_Category__c: "Pipeline Start Driver", Calculation_Version__c: "market-explanation-v2" }),
      row({ Contributor_Category__c: "Availability Increase Driver", Calc_Notes__c: calcNotes({ metric: "availability" }) }),
    ]);
    expect(result.facts).toHaveLength(4);
    expect(result.facts.filter((fact) => fact.trusted === false)).toHaveLength(3);
    expect(result.facts.filter((fact) => fact.trusted === false).every((fact) => fact.evidenceStrength === "unspecified" && !fact.driverType)).toBe(true);
    expect(result.diagnostics).toHaveLength(3);
    expect(parseExplanationCalcNotes(row({ Calc_Notes__c: "[]" })).diagnostic).toMatch(/not a JSON object/);
  });

  it("preserves legacy prior-snapshot provenance and comparison warnings", () => {
    const warning = "Comparison quarter is legacy unversioned; authority is established by complete population and official Market Data reconciliation, not active-run flags.";
    const { facts } = mapExplanatoryContributors([
      row({ Calc_Notes__c: calcNotes({ prior_snapshot_provenance: "legacy_unversioned_authoritative", comparison_warnings: [warning], driver_type: "tenant_move_out", evidence_strength: "strong" }) }),
    ]);
    expect(facts[0]).toMatchObject({
      trusted: true,
      priorSnapshotProvenance: "legacy_unversioned_authoritative",
      comparisonWarnings: [warning],
      evidenceStrength: "strong",
    });
  });

  it("preserves Partial-Spec and Expansion construction types and the pipeline event size", () => {
    const { facts } = mapExplanatoryContributors([
      row({ Contributor_Category__c: "Pipeline Start Driver", Narrative_Context__c: "Warehouse p3 started construction on 300,000 SF during Q3.",
        Calc_Notes__c: calcNotes({ metric: "construction", construction_type: "Partial-Spec", driver_type: "construction_start", evidence_strength: "confirmed", change_sf: 300000, pipeline_event_sf: 300000 }) }),
      row({ Contributor_Category__c: "Pipeline Delivery Driver", Display_Title__c: "Warehouse p4", Narrative_Context__c: "Warehouse p4 delivered 100,000 SF during Q3.",
        Calc_Notes__c: calcNotes({ metric: "construction", construction_type: "Expansion", driver_type: "delivery", evidence_strength: "confirmed", change_sf: 0, pipeline_event_sf: 100000 }) }),
    ]);
    expect(facts.map((fact) => fact.constructionType)).toEqual(["Expansion", "Partial-Spec"]);
    expect(facts.find((fact) => fact.constructionType === "Expansion")).toMatchObject({ changeValue: 0, pipelineEventSf: 100000 });
  });

  it("keeps availability-specific explanatory metadata", () => {
    const { facts } = mapExplanatoryContributors([
      row({ Contributor_Category__c: "Availability Increase Driver", Calc_Notes__c: calcNotes({
        metric: "availability", driver_type: "new_availability", evidence_strength: "strong",
        timing_classification: "future", availability_event: "new_availability",
        marketing_classification: "new_marketed_second_generation", direct_change_sf: 100000,
        sublet_change_sf: 0, current_future_available_sf: 100000, availability_evidence_ids: ["a1"] }) }),
    ]);
    expect(facts[0]?.availability).toMatchObject({
      timingClassification: "future",
      availabilityEvent: "new_availability",
      marketingClassification: "new_marketed_second_generation",
      directChangeSf: 100000,
      currentFutureAvailableSf: 100000,
    });
  });

  it("excludes inactive, excluded, narrative-ineligible, or confidential rows", () => {
    const { facts } = mapExplanatoryContributors([
      row({ Active_In_Run__c: false }),
      row({ Included_In_Report__c: false }),
      row({ Narrative_Eligible__c: false }),
      row({ Is_Deal_Confidential__c: true }),
      row({ Narrative_Context__c: "", Display_Value__c: "" }),
    ]);
    expect(facts).toEqual([]);
  });
});

describe("Overall Market explanation rows", () => {
  it("selects current-quarter Overall Market explanation rows and uses the overall share", () => {
    const overall = row({
      Submarket__c: "Overall Market",
      Calc_Notes__c: calcNotes({ overall_change_share_percent: 37.5, market_change_share_percent: undefined, driver_type: "tenant_move_out", evidence_strength: "confirmed" }),
    });
    const rows = [
      overall,
      row({ Submarket__c: "Overall Market", Quarter_Label__c: "2026 Q2" }),
      row({ Submarket__c: "Overall Market", Contributor_Category__c: "Highest Vacancy" }),
      row(),
    ];
    const selected = overallMarketExplanationRows(rows, "2026 Q3");
    expect(selected).toEqual([overall]);
    const { facts } = mapExplanatoryContributors(selected, "overall");
    expect(facts[0]).toMatchObject({ materialityPercent: 37.5, driverType: "tenant_move_out", evidenceStrength: "confirmed" });
  });
});
