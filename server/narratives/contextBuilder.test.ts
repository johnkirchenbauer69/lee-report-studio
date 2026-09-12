import { describe, expect, it } from "vitest";
import { sampleTemplate } from "../../src/data/sampleTemplate.ts";
import { generateReportInstance } from "../../src/report-engine/generation/generateReport.ts";
import { q2SampleReport } from "../../src/data-providers/sample/q2SampleReport.ts";
import {
  buildNarrativeContext,
  NARRATIVE_MATERIALITY,
  publicNarrativeContext,
} from "./contextBuilder.ts";

async function fixture() {
  return generateReportInstance(sampleTemplate, {
    templateId: sampleTemplate.id,
    templateVersion: sampleTemplate.version,
    market: "Chicago",
    period: "2026 Q2",
    calculationScope: { type: "all-submarkets" },
    pageSelection: { submarketIds: [] },
    source: { provider: "sample" },
  });
}

describe("buildNarrativeContext", () => {
  it("builds stable Overall context from all 18 canonical submarkets", async () => {
    const instance = await fixture();
    const first = buildNarrativeContext({ reportInstance: instance, marketId: "overall-market" });
    const second = buildNarrativeContext({ reportInstance: structuredClone(instance), marketId: "overall-market" });
    expect(instance.dataSnapshot.submarkets).toHaveLength(18);
    expect(first.contextHash).toBe(second.contextHash);
    // 5 ranked metrics (absorption, vacancy, availability, under construction,
    // sales volume) × 2 directions × 3 leaderboard materiality. The sample
    // fixture's submarketDetails carry no historicalPeriods, so the leasing
    // activity ranking (which requires every submarket to have one) is
    // correctly omitted here.
    expect(first.facts.filter((item) => item.category === "ranking")).toHaveLength(30);
    expect(first.facts.some((item) => item.contextKey === "metric.vacancy.qoq_bps")).toBe(true);
    expect(first.facts.find((item) => item.contextKey === "metric.median_sales_price_psf.current")?.value).toBeNull();
  });

  it("scopes submarket context and excludes confidential or unknown leases", async () => {
    const instance = await fixture();
    const central = instance.dataSnapshot.submarketDetails.find((item) => item.name === "Central DuPage")!;
    const ohare = instance.dataSnapshot.submarketDetails.find((item) => item.name === "O'Hare")!;
    central.leasing = [
      { tenant: "Public Tenant", tenantDisplayName: "Public Tenant", isDealConfidential: false, sizeSf: 200_000, address: "100 Public Road", leaseType: "Direct / New" },
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
      sizeSf: 100_000 - index,
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
    expect(context.facts.filter((item) => item.category === "lease")).toHaveLength(NARRATIVE_MATERIALITY.leases);
    expect(context.facts.some((item) => item.internalSourceIds?.includes("001A0000009z3ZI"))).toBe(true);
    const clientContext = JSON.stringify(publicNarrativeContext(context));
    expect(clientContext).not.toContain("001A0000009z3ZI");
    expect(clientContext).not.toContain("001A0000009z3ZIAAZ");
  });

  it("derives QoQ, YoY, YTD, and historical-context facts from the overall market's 8-quarter history", async () => {
    const instance = await fixture();
    const history = instance.dataSnapshot.historicalPeriods;
    expect(history.length).toBeGreaterThanOrEqual(8);
    const context = buildNarrativeContext({ reportInstance: instance, marketId: "overall-market" });
    const byKey = (key: string) => context.facts.find((item) => item.contextKey === key);

    // QoQ additions
    expect(byKey("metric.net_absorption.qoq_change_sf")?.value).toBe(
      history[0]!.quarterlyNetAbsorptionSf - history[1]!.quarterlyNetAbsorptionSf,
    );
    expect(byKey("metric.leasing_activity.qoq_percent")).toBeTruthy();

    // YoY (Q2 2026 vs. Q2 2025, present at index 4 in the sample history)
    const priorYear = history.find((item) => item.period === "2025 Q2")!;
    const vacancyYoy = byKey("metric.vacancy.yoy_bps");
    expect(vacancyYoy).toBeDefined();
    expect(vacancyYoy?.value as number).toBeCloseTo(
      (history[0]!.vacancyRate - priorYear.vacancyRate) * 10_000,
      5,
    );

    // YTD (Q1 + Q2 2026, both present)
    const ytdAbsorption = byKey("ytd.net_absorption");
    expect(ytdAbsorption?.value).toBe(
      history[0]!.quarterlyNetAbsorptionSf + history[1]!.quarterlyNetAbsorptionSf,
    );

    // Historical extremes and multi-quarter averages
    expect(context.facts.some((item) => item.contextKey === "historical.vacancy.highest")).toBe(true);
    expect(context.facts.some((item) => item.contextKey === "historical.net_absorption.avg_4q")).toBe(true);
    expect(context.facts.some((item) => item.contextKey === "historical.net_absorption.avg_8q")).toBe(true);
  });

  it("derives counts, construction composition, leasing concentration, and market-driver facts from a submarket's governed records", async () => {
    const instance = await fixture();
    const detail = instance.dataSnapshot.submarketDetails.find((item) => item.name === "Central DuPage")!;
    const periodLabels = [
      "2026 Q2",
      "2026 Q1",
      "2025 Q4",
      "2025 Q3",
      "2025 Q2",
      "2025 Q1",
      "2024 Q4",
      "2024 Q3",
    ];
    const periods = periodLabels.map((period, index) => {
      return {
        period,
        quarterlyNetAbsorptionSf: index < 4 ? 100_000 - index * 20_000 : -20_000,
        trailing12MonthNetAbsorptionSf: 400_000,
        trailing12MonthNetAbsorptionStatus: "complete" as const,
        vacancyRate: 0.06 - index * 0.005,
        availabilityRate: 0.09 - index * 0.005,
        underConstructionSf: 500_000 + index * 10_000,
        deliveredSf: index === 0 ? 50_000 : 0,
        salesVolume: 1_000_000 - index * 10_000,
        medianSalesPricePsf: 100,
        leasingActivitySf: 2_000_000 - index * 50_000,
      };
    });
    detail.historicalPeriods = periods;
    detail.metrics.speculativeShare = 0.05;
    detail.absorptionContributors = [
      {
        propertyName: "Big Move-In LLC",
        address: "1 Move-In Way",
        contributionSf: 500_000,
        direction: "positive",
        evidenceType: "property_data_net_absorption",
        deterministicallyIdentified: true,
      },
      {
        propertyName: "Empty Warehouse Co",
        address: "2 Vacant Ave",
        contributionSf: -300_000,
        direction: "negative",
        evidenceType: "property_data_net_absorption",
        deterministicallyIdentified: true,
      },
    ];
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

    // Counts (section D.4)
    expect(byKey("count.leases")?.value).toBe(3);
    expect(byKey("count.construction_projects")?.value).toBe(2);

    // Construction composition (section D.5)
    expect(byKey("composition.speculative_sf")?.value).toBe(50_000);
    expect(byKey("composition.bts_sf")?.value).toBe(950_000);
    expect(byKey("composition.bts_share")?.value).toBeCloseTo(0.95, 5);

    // Historical streak: 4 consecutive quarters of positive absorption before
    // the sign flips (section D.6)
    const streak = byKey("historical.net_absorption.streak");
    expect(streak?.value).toBe(4);
    expect(streak?.displayValue).toContain("positive");

    // Leasing concentration (section D.8)
    expect(byKey("concentration.large_lease_count")?.value).toBe(2);
    expect(byKey("concentration.large_lease_sf")?.value).toBe(1_300_000);
    expect(byKey("concentration.large_lease_share")?.value).toBeCloseTo(1_300_000 / 2_000_000, 5);

    // Market drivers (section E) — every driver must cite a real,
    // publication-safe entity name from the governed context.
    const drivers = context.facts.filter((item) => item.category === "market_driver");
    expect(drivers.length).toBeGreaterThan(0);
    const driverKeys = drivers.map((item) => item.contextKey);
    expect(driverKeys).toContain("market_driver.absorption_gain_move_ins");
    expect(driverKeys).toContain("market_driver.speculative_pipeline_limited");
    expect(driverKeys).toContain("market_driver.deliveries_dominated_by_bts");
    expect(driverKeys).toContain("market_driver.leasing_concentration_large_leases");
    const absorptionDriver = drivers.find((item) => item.contextKey === "market_driver.absorption_gain_move_ins")!;
    expect(absorptionDriver.entityNames).toContain("Big Move-In LLC");
    expect(absorptionDriver.displayValue).toContain("Big Move-In LLC");
  });

  it("omits internal workflow notes from lease, sale, and property entities rather than publishing them", async () => {
    const instance = await fixture();
    instance.dataSnapshot.leasing = [
      { tenant: "Acme Logistics - waiting for comp", isDealConfidential: false, sizeSf: 300_000, address: "1 Main St", leaseType: "Direct / New" },
      { tenant: "TBD", isDealConfidential: false, sizeSf: 250_000, address: "2 Main St", leaseType: "Direct / New" },
    ];
    instance.dataSnapshot.sales = [
      { buyer: "Internal note: confirm buyer", price: 1_000_000, address: "3 Main St", saleType: "Investment" },
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
    expect(leaseFacts.find((item) => item.value === 250_000)?.entityNames).toEqual(["2 Main St"]);
    expect(leaseFacts.find((item) => item.value === 300_000)?.entityNames).toContain("Acme Logistics");
  });

  it("preserves missing metrics as null/Unavailable and genuine zeros as zero", async () => {
    const instance = await fixture();
    const metrics = instance.dataSnapshot.overallMarket as unknown as Record<string, unknown>;
    metrics.askingNetRentPsf = undefined;
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
