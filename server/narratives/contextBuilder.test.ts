import { describe, expect, it } from "vitest";
import { sampleTemplate } from "../../src/data/sampleTemplate.ts";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport.ts";
import { calculateMarketTotals } from "../../src/report-engine/calculations/marketCalculations.ts";
import type {
  GovernedExplanatoryFact,
  HistoricalMarketPeriod,
} from "../../src/report-engine/schema/industrialMarketReport.ts";
import {
  buildNarrativeContext,
  formatAskingRent,
  formatNarrativeCurrency,
  marketBreadthFacts,
  narrativePageContext,
  narrativeReportDataFingerprint,
  NARRATIVE_MATERIALITY,
  publicNarrativeContext,
  transactionMateriality,
  TRANSACTION_MATERIALITY,
} from "./contextBuilder.ts";

async function fixture(submarketIds: string[] = []) {
  return generateReportInstance(sampleTemplate, {
    templateId: sampleTemplate.id,
    templateVersion: sampleTemplate.version,
    market: "Chicago",
    period: "2026 Q2",
    calculationScope: { type: "all-submarkets" },
    pageSelection: { submarketIds },
    source: { provider: "sample" },
  });
}

const PERIODS = ["2026 Q2", "2026 Q1", "2025 Q4", "2025 Q3", "2025 Q2", "2025 Q1", "2024 Q4", "2024 Q3"];

/** Builds governed history newest-first from per-quarter overrides. */
const history = (
  rows: Partial<HistoricalMarketPeriod>[],
): HistoricalMarketPeriod[] =>
  rows.map((row, index) => ({
    period: PERIODS[index]!,
    quarterlyNetAbsorptionSf: 50_000,
    trailing12MonthNetAbsorptionSf: 200_000,
    trailing12MonthNetAbsorptionStatus: "complete" as const,
    vacancyRate: 0.05,
    availabilityRate: 0.08,
    underConstructionSf: 300_000,
    deliveredSf: 0,
    salesVolume: 10_000_000,
    medianSalesPricePsf: 100,
    leasingActivitySf: 1_000_000,
    ...row,
  }));

const centralDupage = async () => {
  const instance = await fixture();
  const detail = instance.dataSnapshot.submarketDetails.find(
    (item) => item.name === "Central DuPage",
  )!;
  return { instance, detail };
};

const explanatory = (
  input: Partial<GovernedExplanatoryFact> & Pick<GovernedExplanatoryFact, "factType">,
): GovernedExplanatoryFact => ({
  label: "Governed driver",
  displayValue: "Governed driver display",
  narrativeEligible: true,
  // Upstream market-explanation-v1 defaults for a supported cause.
  driverType: "tenant_move_out",
  evidenceStrength: "confirmed",
  explanationVersion: "market-explanation-v1",
  trusted: true,
  ...input,
});

describe("buildNarrativeContext", () => {
  it("builds stable Overall context from all 18 canonical submarkets", async () => {
    const instance = await fixture();
    const first = buildNarrativeContext({ reportInstance: instance, marketId: "overall-market" });
    const second = buildNarrativeContext({ reportInstance: structuredClone(instance), marketId: "overall-market" });
    expect(instance.dataSnapshot.submarkets).toHaveLength(18);
    expect(first.contextHash).toBe(second.contextHash);
    // 5 ranked metrics × 2 directions × 3 leaderboard materiality. The
    // sample submarketDetails carry no history, so the leasing-activity
    // ranking (which needs every submarket's current quarter) is omitted.
    expect(first.facts.filter((item) => item.analyticalType === "ranking")).toHaveLength(30);
    expect(first.facts.some((item) => item.contextKey === "metric.vacancy.qoq_bps")).toBe(true);
    expect(first.facts.find((item) => item.contextKey === "metric.median_sales_price_psf.current")?.value).toBeNull();
    expect(first.editorialBrief?.contextModelVersion).toBe("narrative-context-v3");
  });

  it("scopes submarket context and excludes confidential or unknown leases", async () => {
    const { instance, detail: central } = await centralDupage();
    const ohare = instance.dataSnapshot.submarketDetails.find((item) => item.name === "O'Hare")!;
    central.leasing = [
      { tenant: "Public Tenant", tenantDisplayName: "Public Tenant", isDealConfidential: false, sizeSf: 600_000, address: "100 Public Road", leaseType: "Direct / New" },
      { tenant: "Secret Tenant", tenantDisplayName: "Secret Tenant", isDealConfidential: true, sizeSf: 900_000, address: "200 Secret Road", leaseType: "Direct / New" },
      { tenant: "Unknown Tenant", tenantDisplayName: "Unknown Tenant", isDealConfidential: null, sizeSf: 800_000, address: "300 Unknown Road", leaseType: "Direct / New" },
    ];
    ohare.leasing = [
      { tenant: "Other Market Tenant", tenantDisplayName: "Other Market Tenant", isDealConfidential: false, sizeSf: 700_000, address: "400 Other Road", leaseType: "Renewal" },
    ];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    const serialized = JSON.stringify(publicNarrativeContext(context));
    expect(serialized).toContain("Public Tenant");
    expect(serialized).not.toContain("Secret Tenant");
    expect(serialized).not.toContain("Unknown Tenant");
    expect(serialized).not.toContain("Other Market Tenant");
  });

  it("caps material records and strips internal IDs from client context", async () => {
    const instance = await fixture();
    instance.dataSnapshot.leasing = Array.from({ length: 9 }, (_, index) => ({
      tenant:
        index === 0
          ? "Tenant 001A0000009z3ZIAAZ internal"
          : `Tenant ${index}`,
      isDealConfidential: false,
      sizeSf: 900_000 - index,
      address: `${index + 1} Main Street`,
      leaseType: "Direct / New",
    }));
    instance.dataSnapshot.provenance.push({
      fieldPath: "leasing.0",
      selectedValue: "safe",
      sources: [{ sourceId: "001A0000009z3ZI", sourceType: "salesforce", value: "safe", reference: "Lease" }],
      authority: "test",
      status: "matched",
    });
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "overall-market" });
    expect(context.facts.filter((item) => item.category === "lease")).toHaveLength(NARRATIVE_MATERIALITY.overallLeases);
    expect(context.facts.some((item) => item.internalSourceIds?.includes("001A0000009z3ZI"))).toBe(true);
    const clientContext = JSON.stringify(publicNarrativeContext(context));
    expect(clientContext).not.toContain("001A0000009z3ZI");
    expect(clientContext).not.toContain("001A0000009z3ZIAAZ");
  });

  it("derives QoQ, YoY, YTD, and historical-context facts from the overall market's 8-quarter history", async () => {
    const instance = await fixture();
    const overallHistory = instance.dataSnapshot.historicalPeriods;
    expect(overallHistory.length).toBeGreaterThanOrEqual(8);
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "overall-market" });
    const byKey = (key: string) => context.facts.find((item) => item.contextKey === key);
    expect(byKey("metric.net_absorption.qoq_change_sf")?.value).toBe(
      overallHistory[0]!.quarterlyNetAbsorptionSf! - overallHistory[1]!.quarterlyNetAbsorptionSf!,
    );
    expect(byKey("metric.leasing_activity.qoq_percent")).toBeTruthy();
    const priorYear = overallHistory.find((item) => item.period === "2025 Q2")!;
    expect(byKey("metric.vacancy.yoy_bps")?.value as number).toBeCloseTo(
      (overallHistory[0]!.vacancyRate! - priorYear.vacancyRate!) * 10_000,
      5,
    );
    expect(byKey("ytd.net_absorption")?.value).toBe(
      overallHistory[0]!.quarterlyNetAbsorptionSf! + overallHistory[1]!.quarterlyNetAbsorptionSf!,
    );
    expect(byKey("historical.vacancy.highest")).toBeTruthy();
    expect(byKey("historical.net_absorption.avg_4q")).toBeTruthy();
    expect(byKey("historical.net_absorption.avg_8q")).toBeTruthy();
    expect(byKey("historical.leasing_activity.vs_prior_4q_avg")).toBeTruthy();
  });

  it("derives counts, construction composition, and leasing concentration without inventing drivers", async () => {
    const { instance, detail } = await centralDupage();
    detail.historicalPeriods = history(
      PERIODS.map((_, index) => ({
        quarterlyNetAbsorptionSf: index < 4 ? 100_000 - index * 20_000 : -20_000,
        vacancyRate: 0.06 - index * 0.005,
        availabilityRate: 0.09 - index * 0.005,
        underConstructionSf: 500_000 + index * 10_000,
        leasingActivitySf: 2_000_000 - index * 50_000,
      })),
    );
    detail.metrics.speculativeShare = 0.05;
    detail.construction = [
      { address: "10 Spec Way", sizeSf: 50_000, type: "Speculative", sponsor: "Spec Co", image: "" },
      { address: "20 BTS Way", sizeSf: 950_000, type: "Built-to-Suit", sponsor: "BTS Co", image: "" },
    ];
    detail.leasing = [
      { tenant: "Big Tenant A", isDealConfidential: false, sizeSf: 600_000, address: "1 A St", leaseType: "Direct / New" },
      { tenant: "Big Tenant B", isDealConfidential: false, sizeSf: 700_000, address: "2 B St", leaseType: "Direct / New" },
      { tenant: "Small Tenant C", isDealConfidential: false, sizeSf: 100_000, address: "3 C St", leaseType: "Renewal" },
    ];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    const byKey = (key: string) => context.facts.find((item) => item.contextKey === key);
    expect(byKey("count.leases")?.value).toBe(3);
    expect(byKey("count.construction_projects")?.value).toBe(2);
    expect(byKey("composition.speculative_sf")?.value).toBe(50_000);
    expect(byKey("composition.bts_share")?.value).toBeCloseTo(0.95, 5);
    expect(byKey("composition.speculative_pipeline_limited")).toBeTruthy();
    expect(byKey("composition.construction_bts_dominant")).toBeTruthy();
    expect(byKey("historical.net_absorption.streak")?.value).toBe(4);
    expect(byKey("concentration.large_lease_sf")?.value).toBe(1_300_000);
    expect(byKey("concentration.large_lease_share")?.value).toBeCloseTo(1_300_000 / 2_000_000, 5);
    expect(byKey("concentration.large_lease_dominant")).toBeTruthy();
    // Descriptive composition never licenses causal wording.
    expect(context.facts.filter((item) => item.causalSupport === true)).toHaveLength(0);
  });

  it("omits internal workflow notes from lease, sale, and property entities rather than publishing them", async () => {
    const instance = await fixture();
    instance.dataSnapshot.leasing = [
      { tenant: "Acme Logistics - waiting for comp", isDealConfidential: false, sizeSf: 900_000, address: "1 Main St", leaseType: "Direct / New" },
      { tenant: "TBD", isDealConfidential: false, sizeSf: 850_000, address: "2 Main St", leaseType: "Direct / New" },
    ];
    instance.dataSnapshot.sales = [
      { buyer: "Internal note: confirm buyer", price: 300_000_000, address: "3 Main St", saleType: "Investment" },
    ];
    instance.dataSnapshot.construction = [
      { address: "4 Main St", sizeSf: 400_000, type: "Speculative", sponsor: "Need comp", developer: "Need comp", image: "" },
    ];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "overall-market" });
    const serialized = JSON.stringify(publicNarrativeContext(context));
    expect(serialized).not.toContain("waiting for comp");
    expect(serialized).toContain("Acme Logistics");
    expect(serialized).not.toContain("TBD");
    expect(serialized).not.toContain("Internal note");
    expect(serialized).not.toContain("Need comp");
    const leaseFacts = context.facts.filter((item) => item.category === "lease");
    expect(leaseFacts.find((item) => item.value === 850_000)?.entityNames).toEqual(["2 Main St"]);
    expect(leaseFacts.find((item) => item.value === 900_000)?.entityNames).toContain("Acme Logistics");
  });

  it("preserves missing metrics as null/Unavailable and genuine zeros as zero", async () => {
    const instance = await fixture();
    const metrics = instance.dataSnapshot.overallMarket as unknown as Record<string, unknown>;
    metrics.askingNetRentPsf = undefined;
    // A genuine zero on the authoritative Overall Market object stays zero.
    metrics.salesVolume = 0;
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "overall-market" });
    expect(context.facts.find((item) => item.contextKey === "metric.asking_rent.current")).toMatchObject({
      value: null,
      displayValue: "Unavailable",
    });
    expect(context.facts.find((item) => item.contextKey === "metric.sales_volume.current")).toMatchObject({
      value: 0,
      displayValue: "$0",
    });
  });
});

describe("narrative context v3: governed causality", () => {
  it("does not infer a vacancy cause from rising vacancy plus negative absorption contributors", async () => {
    const { instance, detail } = await centralDupage();
    detail.historicalPeriods = history([
      { vacancyRate: 0.06, quarterlyNetAbsorptionSf: 120_000 },
      { vacancyRate: 0.055 },
      { vacancyRate: 0.05 },
    ]);
    detail.metrics.quarterlyNetAbsorptionSf = 120_000;
    detail.absorptionContributors = [
      { propertyName: "Empty Warehouse Co", address: "2 Vacant Ave", contributionSf: -300_000, direction: "negative", evidenceType: "property_data_net_absorption", deterministicallyIdentified: true },
      { propertyName: "Big Move-In LLC", address: "1 Move-In Way", contributionSf: 420_000, direction: "positive", evidenceType: "property_data_net_absorption", deterministicallyIdentified: true },
    ];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    const serialized = JSON.stringify(publicNarrativeContext(context));
    expect(serialized).not.toMatch(/second-generation/i);
    expect(serialized).not.toMatch(/associated with|tied to/i);
    expect(context.facts.some((item) => item.contextKey.startsWith("market_driver.vacancy"))).toBe(false);
    expect(context.facts.filter((item) => item.causalSupport === true)).toHaveLength(0);
    expect(context.editorialBrief?.causalCoverage).toMatchObject({
      vacancy: "movement_only",
      availability: "movement_only",
      absorption: "contributors_only",
    });
    // The movement itself is still stated, deterministically and without a cause.
    const divergence = context.facts.find(
      (item) => item.contextKey === "metric.vacancy_vs_absorption.divergence",
    );
    expect(divergence?.displayValue).toBe(
      "Vacancy rose 50 basis points to 6.0% despite positive quarterly net absorption of +120,000 SF",
    );
    expect(divergence?.causalSupport).toBe(false);
    // Contributors are components of absorption, not causes of vacancy.
    const contributor = context.facts.find((item) => item.contextKey === "driver.absorption.positive.1");
    expect(contributor).toMatchObject({ causalSupport: false, analyticalType: "materiality" });
    expect(contributor?.materialityPercent).toBeCloseTo(350, 0);
  });

  it("consumes an explicit governed vacancy bridge driver and licenses causal wording", async () => {
    const { instance, detail } = await centralDupage();
    detail.explanatoryFacts = [
      explanatory({
        factType: "vacancy_bridge",
        driverType: "tenant_move_out",
        evidenceStrength: "strong",
        label: "Vacancy Increase Driver: Empty Warehouse Co",
        displayValue: "Second-generation space at 2 Vacant Ave returned 300,000 SF to the market, accounting for 62.0% of the vacancy increase",
        metric: "vacancy_rate",
        priorValue: 0.055,
        currentValue: 0.06,
        changeValue: 0.005,
        materialityPercent: 62,
        propertyName: "Empty Warehouse Co",
        address: "2 Vacant Ave",
      }),
    ];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    const bridge = context.facts.find((item) => item.contextKey === "governed.vacancy_bridge.1");
    expect(bridge).toMatchObject({
      category: "market_driver",
      analyticalType: "vacancy_bridge",
      driverType: "tenant_move_out",
      evidenceStrength: "strong",
      causalSupport: true,
      editorialPriority: "lead",
      materialityPercent: 62,
      sourceType: "Market_Data_Contributor__c",
    });
    expect(bridge?.entityNames).toEqual(["Empty Warehouse Co", "2 Vacant Ave"]);
    expect(context.editorialBrief?.causalCoverage.vacancy).toBe("governed_driver");
    expect(context.editorialBrief?.causalCoverage.availability).toBe("movement_only");
  });

  it("consumes an explicit governed availability driver and gates indicative evidence", async () => {
    const { instance, detail } = await centralDupage();
    detail.explanatoryFacts = [
      explanatory({
        factType: "availability_bridge",
        driverType: "new_availability",
        label: "Availability Increase Driver: Sublease space",
        displayValue: "Sublease space added 410,000 SF of available space from Q2 to Q3.",
        evidenceStrength: "strong",
      }),
      explanatory({
        factType: "availability_bridge",
        driverType: "unknown",
        label: "Availability Increase Driver: Warehouse p9",
        displayValue: "Warehouse p9 added 150,000 SF of available space from Q2 to Q3.",
        evidenceStrength: "indicative",
      }),
    ];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    expect(context.facts.find((item) => item.contextKey === "governed.availability_bridge.1")?.causalSupport).toBe(true);
    const indicative = context.facts.find((item) => item.contextKey === "governed.availability_bridge.2");
    expect(indicative).toMatchObject({ causalSupport: false, evidenceStrength: "indicative", editorialPriority: "supporting" });
    expect(indicative?.label).toContain("measured change only");
    expect(context.editorialBrief?.causalCoverage.availability).toBe("governed_driver");
  });

  it("marks a lease signed this quarter with a future commencement as not yet occupied", async () => {
    const { instance, detail } = await centralDupage();
    detail.explanatoryFacts = [
      explanatory({
        factType: "leasing_conversion",
        driverType: "signed_not_commenced",
        label: "Large lease signed",
        displayValue: "Big Tenant A signed 600,000 SF at 1 A St",
        tenantName: "Big Tenant A",
        signedPeriod: "2026 Q2",
        commencementPeriod: "2026 Q4",
      }),
    ];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    const conversion = context.facts.find((item) => item.contextKey === "governed.leasing_conversion.1");
    expect(conversion?.label).toContain("occupancy commences 2026 Q4, after this report period");
    expect(conversion?.label).toContain("not yet reflected in absorption or vacancy");
    expect(context.editorialBrief?.causalCoverage.leasingConversion).toBe("governed_driver");
  });

  it("drops explanatory facts that are confidential or not narrative-eligible", async () => {
    const { instance, detail } = await centralDupage();
    detail.explanatoryFacts = [
      explanatory({ factType: "vacancy_bridge", displayValue: "Confidential move-out", isConfidential: true }),
      explanatory({ factType: "vacancy_bridge", displayValue: "Ineligible move-out", narrativeEligible: false }),
    ];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    const serialized = JSON.stringify(publicNarrativeContext(context));
    expect(serialized).not.toContain("Confidential move-out");
    expect(serialized).not.toContain("Ineligible move-out");
    expect(context.editorialBrief?.causalCoverage.vacancy).toBe("movement_only");
  });

  it("lets an engine-supplied absorption bridge supersede the local contributor listing", async () => {
    const { instance, detail } = await centralDupage();
    detail.absorptionContributors = [
      { propertyName: "Big Move-In LLC", contributionSf: 420_000, direction: "positive", evidenceType: "property_data_net_absorption", deterministicallyIdentified: true },
    ];
    detail.explanatoryFacts = [explanatory({ factType: "absorption_bridge", displayValue: "Two move-ins totaling 520,000 SF drove absorption" })];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    expect(context.facts.some((item) => item.contextKey.startsWith("driver.absorption."))).toBe(false);
    expect(context.editorialBrief?.causalCoverage.absorption).toBe("governed_driver");
  });
});

describe("narrative context v3: transaction materiality", () => {
  it("scores by rank, absolute size, share, and driver relevance", () => {
    const base = {
      quarterTotal: 400_000,
      largeThreshold: TRANSACTION_MATERIALITY.leaseLargeSf,
      mediumThreshold: TRANSACTION_MATERIALITY.leaseMediumSf,
      driverLinked: false,
    };
    // A quiet market's #3 lease is not material merely because it ranks.
    expect(transactionMateriality({ ...base, rankIndex: 2, amount: 30_000 }).material).toBe(false);
    // The leading lease taking a major share of the quarter is material.
    expect(transactionMateriality({ ...base, rankIndex: 0, amount: 150_000 }).material).toBe(true);
    // Absolute scale alone is material.
    expect(transactionMateriality({ ...base, rankIndex: 4, amount: 700_000, quarterTotal: 20_000_000 }).material).toBe(true);
    // A governed driver naming the transaction makes it material.
    expect(transactionMateriality({ ...base, rankIndex: 2, amount: 30_000, driverLinked: true }).material).toBe(true);
    // ...but only with confirmed or strong evidence; an indicative link is one point.
    expect(transactionMateriality({ ...base, rankIndex: 2, amount: 30_000, driverLinked: true, driverEvidence: "indicative" }).material).toBe(false);
    expect(transactionMateriality({ ...base, rankIndex: 2, amount: 30_000, driverLinked: true, driverEvidence: "strong" }).material).toBe(true);
  });

  it("does not let an indicative driver pull a small lease into the narrative", async () => {
    const { instance, detail } = await centralDupage();
    detail.historicalPeriods = history([{ leasingActivitySf: 2_000_000 }, {}]);
    detail.leasing = [
      { tenant: "Anchor Tenant", isDealConfidential: false, sizeSf: 650_000, address: "1 Anchor Rd", leaseType: "Direct / New" },
      { tenant: "Small Tenant", isDealConfidential: false, sizeSf: 45_000, address: "3 Small Rd", leaseType: "Renewal" },
    ];
    detail.explanatoryFacts = [explanatory({ factType: "vacancy_bridge", displayValue: "Small Tenant vacated 45,000 SF", tenantName: "Small Tenant", evidenceStrength: "indicative" })];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    expect(context.facts.filter((item) => item.category === "lease").map((item) => item.label)).toEqual(["Anchor Tenant"]);
  });

  it("omits a lease shown in Top Leases unless it is analytically material", async () => {
    const { instance, detail } = await centralDupage();
    detail.historicalPeriods = history([{ leasingActivitySf: 2_000_000 }, {}]);
    detail.leasing = [
      { tenant: "Anchor Tenant", isDealConfidential: false, sizeSf: 650_000, address: "1 Anchor Rd", leaseType: "Direct / New" },
      { tenant: "Mid Tenant", isDealConfidential: false, sizeSf: 120_000, address: "2 Mid Rd", leaseType: "Renewal" },
      { tenant: "Small Tenant", isDealConfidential: false, sizeSf: 45_000, address: "3 Small Rd", leaseType: "Renewal" },
    ];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    const leases = context.facts.filter((item) => item.category === "lease");
    expect(leases.map((item) => item.label)).toEqual(["Anchor Tenant"]);
    expect(leases[0]?.visibleOn).toEqual(["top_leases"]);
    expect(leases[0]?.materialityPercent).toBeCloseTo(32.5, 1);
    // The full quarter count is still available for context.
    expect(context.facts.find((item) => item.contextKey === "count.leases")?.value).toBe(3);
  });

  it("keeps a small lease when a governed driver names it", async () => {
    const { instance, detail } = await centralDupage();
    detail.historicalPeriods = history([{ leasingActivitySf: 2_000_000 }, {}]);
    detail.leasing = [
      { tenant: "Anchor Tenant", isDealConfidential: false, sizeSf: 650_000, address: "1 Anchor Rd", leaseType: "Direct / New" },
      { tenant: "Small Tenant", isDealConfidential: false, sizeSf: 45_000, address: "3 Small Rd", leaseType: "Renewal" },
    ];
    detail.explanatoryFacts = [explanatory({ factType: "vacancy_bridge", displayValue: "Small Tenant vacated 45,000 SF", tenantName: "Small Tenant" })];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    expect(context.facts.filter((item) => item.category === "lease").map((item) => item.label)).toEqual([
      "Anchor Tenant",
      "Small Tenant",
    ]);
  });
});

describe("narrative context v3: overall breadth, inflections, formatting", () => {
  it("derives deterministic Overall Market breadth and dispersion facts", async () => {
    const instance = await fixture();
    const report = instance.dataSnapshot;
    // Breadth honours presentation overrides; clear the sample's so the
    // arithmetic below is exact.
    report.presentationOverrides = [];
    report.submarkets.forEach((row, index) => {
      row.quarterlyNetAbsorptionSf = index < 10 ? 100_000 * (index + 1) : index < 12 ? 0 : -50_000;
      row.underConstructionSf = index < 3 ? 1_000_000 : 100_000;
      row.vacancyRate = 0.03 + index * 0.002;
    });
    report.overallMarket.vacancyRate = 0.051;
    report.submarketDetails.forEach((detail, index) => {
      detail.historicalPeriods = history([
        { vacancyRate: 0.05, availabilityRate: index < 4 ? 0.09 : 0.07 },
        { vacancyRate: index < 6 ? 0.04 : 0.06, availabilityRate: 0.08 },
      ]);
    });
    const facts = marketBreadthFacts(report);
    const byKey = (key: string) => facts.find((item) => item.contextKey === `breadth.${key}`);
    expect(byKey("absorption_sign_counts")?.displayValue).toBe(
      "10 of 18 submarkets posted positive net absorption, 6 posted negative net absorption, and 2 were flat",
    );
    // Top three positive: 1.0M + 0.9M + 0.8M of 5.5M gross positive.
    expect(byKey("top3_absorption_share")?.value).toBeCloseTo(2_700_000 / 5_500_000, 5);
    expect(byKey("top3_construction_share")?.value).toBeCloseTo(3_000_000 / 4_500_000, 5);
    expect(byKey("median_vacancy")?.value).toBeCloseTo((0.046 + 0.048) / 2, 6);
    expect(byKey("vacancy_vs_overall")?.displayValue).toBe(
      "7 submarkets had vacancy above the overall rate of 5.1% and 11 were below it",
    );
    expect(byKey("vacancy_direction_counts")?.displayValue).toBe(
      "Vacancy rose in 6 submarkets, fell in 12, and was unchanged in 0",
    );
    expect(byKey("availability_direction_counts")?.displayValue).toBe(
      "Availability rose in 4 submarkets, fell in 14, and was unchanged in 0",
    );
    // Opposite moves: 2 (vacancy up, availability down) + 0 + ... computed deterministically.
    expect(byKey("vacancy_availability_divergence")?.value).toBe(2);
    expect(facts.every((item) => item.publicationSafe && item.analyticalType === "market_breadth")).toBe(true);
    // An engine-supplied breadth measure is never recalculated locally.
    expect(marketBreadthFacts(report, new Set(["median_vacancy"])).some((item) => item.contextKey === "breadth.median_vacancy")).toBe(false);
  });

  it("derives inflection facts without projecting forward", async () => {
    const { instance, detail } = await centralDupage();
    detail.historicalPeriods = history([
      { quarterlyNetAbsorptionSf: 80_000, vacancyRate: 0.05, availabilityRate: 0.08, underConstructionSf: 250_000, leasingActivitySf: 1_500_000 },
      { quarterlyNetAbsorptionSf: -40_000, vacancyRate: 0.055, availabilityRate: 0.075, underConstructionSf: 0, leasingActivitySf: 1_000_000 },
      { quarterlyNetAbsorptionSf: -60_000, vacancyRate: 0.05, availabilityRate: 0.07, underConstructionSf: 0 },
      { quarterlyNetAbsorptionSf: -10_000 },
      { quarterlyNetAbsorptionSf: 30_000 },
    ]);
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    const byKey = (key: string) => context.facts.find((item) => item.contextKey === key);
    expect(byKey("inflection.net_absorption.first_positive_after_streak")?.displayValue).toBe(
      "+80,000 SF of net absorption, the first positive quarter after 3 consecutive negative quarters",
    );
    expect(byKey("inflection.vacancy.direction_reversal")?.displayValue).toBe(
      "Vacancy fell 50 basis points to 5.0% after rising 50 basis points the prior quarter",
    );
    expect(byKey("inflection.availability.direction_reversal")).toBeUndefined();
    expect(byKey("inflection.construction.reactivation")?.displayValue).toBe(
      "250,000 SF under construction after no space was under construction in 2026 Q1",
    );
    expect(byKey("inflection.leasing_activity.acceleration")?.displayValue).toBe(
      "Leasing activity accelerated 50.0% from 2026 Q1",
    );
    const inflections = context.facts.filter((item) => item.analyticalType === "inflection");
    expect(inflections.every((item) => item.causalSupport === false)).toBe(true);
    expect(JSON.stringify(inflections)).not.toMatch(/expected|will|outlook|forecast/i);
  });

  it("formats billions, millions, and asking rent with currency", async () => {
    expect(formatNarrativeCurrency(1_190_000_000)).toBe("$1.19 billion");
    expect(formatNarrativeCurrency(218_400_000)).toBe("$218.4 million");
    expect(formatNarrativeCurrency(999_960_000)).toBe("$1.00 billion");
    expect(formatNarrativeCurrency(950_000)).toBe("$950,000");
    expect(formatAskingRent(8.18)).toBe("$8.18/SF");
    const instance = await fixture();
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "overall-market" });
    expect(context.facts.find((item) => item.contextKey === "metric.asking_rent.current")?.displayValue).toMatch(/^\$\d+\.\d{2}\/SF$/);
  });

  it("cites the authoritative Overall Market sales volume that the Market Totals row renders, never a submarket sum", async () => {
    const instance = await fixture();
    instance.dataSnapshot.overallMarket.salesVolume = 999_000_000;
    const submarketSum = calculateMarketTotals(instance.dataSnapshot.submarkets).salesVolume;
    expect(submarketSum).not.toBe(999_000_000);
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "overall-market" });
    const sales = context.facts.find((item) => item.contextKey === "metric.sales_volume.current");
    expect(sales?.value).toBe(999_000_000);
    expect(sales?.displayValue).toBe(formatNarrativeCurrency(999_000_000));
  });

  it("resolves headline metrics through explicit presentation overrides like the page does", async () => {
    const instance = await fixture();
    instance.dataSnapshot.presentationOverrides.push({
      fieldPath: "overallMarket.quarterlyNetAbsorptionSf",
      value: 1_234_567,
      authority: "Research director",
      reason: "Published restatement",
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "overall-market" });
    expect(context.facts.find((item) => item.contextKey === "metric.net_absorption.current")?.value).toBe(1_234_567);
  });
});

describe("narrative context v3: market activity (paragraph steering)", () => {
  it("classifies a quiet submarket as quiet and a busy, explained one as active", async () => {
    const { instance, detail } = await centralDupage();
    detail.metrics.inventorySf = 50_000_000;
    detail.metrics.quarterlyNetAbsorptionSf = 20_000;
    detail.metrics.underConstructionSf = 0;
    detail.historicalPeriods = history([{ leasingActivitySf: 150_000 }, {}]);
    expect(
      buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" }).editorialBrief?.marketActivity,
    ).toBe("quiet");

    detail.metrics.quarterlyNetAbsorptionSf = 600_000;
    detail.metrics.underConstructionSf = 900_000;
    detail.historicalPeriods = history([{ leasingActivitySf: 1_500_000 }, {}]);
    detail.explanatoryFacts = [
      explanatory({ factType: "absorption_bridge", displayValue: "Two move-ins drove absorption" }),
      explanatory({ factType: "pipeline_change", displayValue: "Two speculative starts added 900,000 SF" }),
    ];
    expect(
      buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" }).editorialBrief?.marketActivity,
    ).toBe("active");
  });
});

describe("narrative context v3: page awareness and transport", () => {
  it("derives page context from the generated report pages", async () => {
    const instance = await fixture(["central-dupage"]);
    expect(narrativePageContext(instance, "overall-market")).toEqual({
      marketIndicatorsVisible: true,
      trendChartsVisible: true,
      submarketTableVisible: true,
      topLeasesVisible: true,
      topSalesVisible: true,
      propertyCardsVisible: true,
      detailedSupplyPageFollows: true,
    });
    expect(narrativePageContext(instance, "central-dupage")).toMatchObject({
      marketIndicatorsVisible: true,
      submarketTableVisible: false,
      topLeasesVisible: true,
    });
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "overall-market" });
    expect(context.facts.find((item) => item.contextKey === "metric.vacancy.current")?.visibleOn).toEqual(
      expect.arrayContaining(["market_indicators", "submarket_table"]),
    );
  });

  it("re-stales the context when page composition changes", async () => {
    const instance = await fixture();
    const before = buildNarrativeContext({ reportInstance: instance, marketId: "overall-market" }).contextHash;
    const overview = instance.pages.find((page) => page.id === "market-overview")!;
    overview.elements = overview.elements.filter(
      (element) => (element as { sourcePath?: string }).sourcePath !== "topLeaseRows",
    );
    const after = buildNarrativeContext({ reportInstance: instance, marketId: "overall-market" });
    expect(after.editorialBrief?.pageContext.topLeasesVisible).toBe(false);
    expect(after.contextHash).not.toBe(before);
  });

  it("keeps the narrative-v2 transport profile on the wire and carries v3 in the editorial brief", async () => {
    const instance = await fixture();
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    expect(context.promptVersion).toBe("submarket-v3");
    const wire = publicNarrativeContext(context);
    expect(wire.promptVersion).toBe("submarket-v2");
    expect(wire.promptProfile).toEqual({
      version: "submarket-v2",
      targetMinWords: 160,
      targetMaxWords: 230,
      hardMaxWords: 275,
      targetParagraphsMin: 2,
      targetParagraphsMax: 4,
    });
    expect(wire.contextHash).toBe(context.contextHash);
    expect(wire.editorialBrief?.editorialProfile).toMatchObject({
      version: "submarket-v3",
      targetMinWords: 175,
      targetMaxWords: 240,
      hardMaxWords: 275,
      targetParagraphsMin: 2,
      targetParagraphsMax: 3,
    });
    // Every fact category stays inside the frozen narrative-v2 enum.
    const v2Categories = new Set(["metric", "trend", "ranking", "driver", "lease", "sale", "availability", "construction", "delivery", "count", "composition", "historical", "concentration", "market_driver"]);
    expect(wire.facts.every((item) => v2Categories.has(item.category))).toBe(true);
  });
});

describe("narrativeReportDataFingerprint", () => {
  it("keeps presentation-only cell overrides out of governed context and its fingerprint", async () => {
    const instance = await fixture();
    const before = buildNarrativeContext({ reportInstance: instance, marketId: "overall-market" });
    const fingerprint = narrativeReportDataFingerprint(instance);
    instance.manualOverrides.push({ elementId: "indicator-table", cellKey: '["metricKey:trailing12MonthNetAbsorptionSf","period:2025 Q3"]',
      bindingPath: "indicatorRows.prior", generatedValue: null, overrideValue: "18,086,895", createdAt: "2026-10-06T12:00:00.000Z" });
    expect(narrativeReportDataFingerprint(instance)).toBe(fingerprint);
    expect(buildNarrativeContext({ reportInstance: instance, marketId: "overall-market" })).toEqual(before);
  });
  it("changes with report data and data-bearing overrides, not with narrative prose", async () => {
    const instance = await fixture();
    const base = narrativeReportDataFingerprint(instance);
    const prose = structuredClone(instance);
    prose.dataSnapshot.overallMarket.narrative = "New prose.";
    expect(narrativeReportDataFingerprint(prose)).toBe(base);
    const data = structuredClone(instance);
    data.dataSnapshot.sales[0]!.price += 1;
    expect(narrativeReportDataFingerprint(data)).not.toBe(base);
    const override = structuredClone(instance);
    override.manualOverrides.push({
      elementId: "table-1",
      bindingPath: "submarketTableRows",
      generatedValue: "$1.2 billion",
      overrideValue: "$1.3 billion",
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    expect(narrativeReportDataFingerprint(override)).not.toBe(base);
  });
});

describe("market-explanation-v1 consumption in narrative context", () => {
  const upstream = (overrides: Partial<GovernedExplanatoryFact>) =>
    explanatory({
      factType: "vacancy_bridge",
      category: "Vacancy Increase Driver",
      label: "Vacancy Increase Driver: 1053 N Schmidt Rd",
      displayValue: "1053 N Schmidt Rd added 499,200 SF of vacant space from Q2 to Q3.",
      propertyName: "1053 N Schmidt Rd",
      metric: "vacancy",
      value: 499_200,
      priorValue: 0,
      currentValue: 499_200,
      changeValue: 499_200,
      priorSnapshotProvenance: "versioned_authoritative",
      ...overrides,
    });

  it("applies the exact confirmed / strong / indicative wording policy", async () => {
    const { instance, detail } = await centralDupage();
    detail.explanatoryFacts = [
      upstream({ driverType: "tenant_move_out", evidenceStrength: "confirmed" }),
      upstream({ driverType: "tenant_move_out", evidenceStrength: "strong" }),
      upstream({ driverType: "unknown", evidenceStrength: "indicative" }),
    ];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    const [confirmed, strong, indicative] = [1, 2, 3].map((index) =>
      context.facts.find((item) => item.contextKey === `governed.vacancy_bridge.${index}`)!,
    );
    expect(confirmed).toMatchObject({ causalSupport: true, evidenceStrength: "confirmed" });
    expect(confirmed!.label).toContain("governed cause: tenant move out, confirmed");
    expect(strong).toMatchObject({ causalSupport: true, evidenceStrength: "strong" });
    expect(strong!.label).toContain("without overstating certainty");
    expect(indicative).toMatchObject({ causalSupport: false, evidenceStrength: "indicative", driverType: "unknown" });
    expect(indicative!.label).toContain("does not establish a cause");
  });

  it("keeps an unknown-cause explanation row a measured statement, even when labelled strong", async () => {
    const { instance, detail } = await centralDupage();
    detail.explanatoryFacts = [
      upstream({ driverType: "unknown", evidenceStrength: "strong" }),
      upstream({
        factType: "availability_bridge",
        category: "Availability Reduction Driver",
        driverType: "availability_removed",
        evidenceStrength: "strong",
        label: "Availability Reduction Driver: 1053 N Schmidt Rd",
        displayValue: "1053 N Schmidt Rd reduced 120,000 SF of available space from Q2 to Q3.",
      }),
    ];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    expect(context.facts.filter((item) => item.causalSupport === true)).toHaveLength(0);
    expect(context.editorialBrief?.causalCoverage).toMatchObject({ vacancy: "movement_only", availability: "movement_only" });
    // The publication-safe Narrative_Context sentence remains available as a measured fact.
    expect(context.facts.find((item) => item.contextKey === "governed.vacancy_bridge.1")?.displayValue).toBe(
      "1053 N Schmidt Rd added 499,200 SF of vacant space from Q2 to Q3.",
    );
  });

  it("never treats untrusted (unparseable) explanation evidence as causal", async () => {
    const { instance, detail } = await centralDupage();
    detail.explanatoryFacts = [
      upstream({ trusted: false, evidenceStrength: "unspecified", driverType: undefined, diagnostics: ["Calc_Notes__c is not valid JSON"] }),
    ];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    const fact = context.facts.find((item) => item.contextKey === "governed.vacancy_bridge.1");
    expect(fact).toMatchObject({ causalSupport: false, editorialPriority: "background" });
    expect(fact?.explanationProvenance?.trusted).toBe(false);
    expect(fact?.label).toContain("structured evidence unavailable");
  });

  it("consumes Overall Market explanation rows and preserves legacy provenance without suppressing them", async () => {
    const instance = await fixture();
    const warning = "Comparison quarter is legacy unversioned; authority is established by complete population and official Market Data reconciliation, not active-run flags.";
    instance.dataSnapshot.explanatoryFacts = [
      upstream({
        driverType: "tenant_move_in",
        evidenceStrength: "confirmed",
        category: "Vacancy Reduction Driver",
        label: "Vacancy Reduction Driver: Warehouse p2",
        displayValue: "Warehouse p2 reduced 400,000 SF of vacant space from Q2 to Q3.",
        propertyName: "Warehouse p2",
        materialityPercent: -41.5,
        priorSnapshotProvenance: "legacy_unversioned_authoritative",
        comparisonWarnings: [warning],
      }),
    ];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "overall-market" });
    const driver = context.facts.find((item) => item.contextKey === "governed.vacancy_bridge.1");
    expect(driver).toMatchObject({ causalSupport: true, materialityPercent: -41.5, editorialPriority: "lead" });
    expect(driver?.explanationProvenance).toMatchObject({
      version: "market-explanation-v1",
      priorSnapshotProvenance: "legacy_unversioned_authoritative",
      comparisonWarnings: [warning],
      trusted: true,
    });
    expect(context.editorialBrief?.causalCoverage.vacancy).toBe("governed_driver");
    // Descriptive breadth stays Report Studio's; causal attribution is never rebuilt locally.
    expect(context.facts.some((item) => item.contextKey === "breadth.absorption_sign_counts")).toBe(true);
    expect(
      context.facts.filter((item) => item.causalSupport === true).every((item) => item.contextKey.startsWith("governed.")),
    ).toBe(true);
    expect(JSON.stringify(publicNarrativeContext(context))).toContain("legacy_unversioned_authoritative");
  });

  it("preserves Partial-Spec and Expansion, and never classifies unknown construction", async () => {
    const { instance, detail } = await centralDupage();
    const pipeline = (constructionType: string, title: string) =>
      upstream({
        factType: "pipeline_change",
        category: "Pipeline Start Driver",
        driverType: "construction_start",
        evidenceStrength: "confirmed",
        constructionType,
        label: `Pipeline Start Driver: ${title}`,
        displayValue: `${title} started construction on 300,000 SF during Q3.`,
        propertyName: title,
        changeValue: 300_000,
        pipelineEventSf: 300_000,
      });
    detail.explanatoryFacts = [
      pipeline("Partial-Spec", "Warehouse p3"),
      pipeline("Expansion", "Warehouse p4"),
      pipeline("Unknown", "Warehouse p5"),
    ];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    const facts = [1, 2, 3].map((index) =>
      context.facts.find((item) => item.contextKey === `governed.pipeline_change.${index}`)!,
    );
    expect(facts.map((item) => item.constructionType)).toEqual(["Partial-Spec", "Expansion", "Unknown"]);
    expect(facts[0]!.label).toContain("construction type: Partial-Spec");
    expect(facts[1]!.label).toContain("construction type: Expansion");
    expect(facts[2]!.label).toContain("construction type not classified");
    expect(facts.every((item) => item.changeValue === 300_000)).toBe(true);
    expect(context.editorialBrief?.causalCoverage.pipeline).toBe("governed_driver");
  });

  it("does not turn a future-commencing lease into occupancy or link it to an unknown vacancy cause", async () => {
    const { instance, detail } = await centralDupage();
    detail.historicalPeriods = history([{ leasingActivitySf: 2_000_000 }, {}]);
    // Upstream counts a lease as a move-in only when it commences in the
    // quarter, so this property's vacancy change stays unknown.
    detail.explanatoryFacts = [upstream({ driverType: "unknown", evidenceStrength: "indicative" })];
    detail.leasing = [
      { tenant: "Anchor Tenant", isDealConfidential: false, sizeSf: 650_000, address: "1 Anchor Rd", leaseType: "Direct / New" },
      { tenant: "Future Tenant", isDealConfidential: false, sizeSf: 45_000, address: "1053 N Schmidt Rd", leaseType: "Direct / New" },
    ];
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "central-dupage" });
    expect(context.facts.filter((item) => item.category === "lease").map((item) => item.label)).toEqual(["Anchor Tenant"]);
    expect(context.facts.some((item) => item.causalSupport === true)).toBe(false);
  });
});
