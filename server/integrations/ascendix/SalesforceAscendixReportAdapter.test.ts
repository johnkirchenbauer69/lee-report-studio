import { describe, expect, it } from "vitest";
import type {
  SalesforceClient,
  SalesforceRecord,
} from "../salesforce/SalesforceClient.ts";
import {
  CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS,
  salesforceFieldMap,
} from "./salesforceFieldMap.ts";
import { SalesforceAscendixReportAdapter } from "./SalesforceAscendixReportAdapter.ts";
import { ReportDataService } from "../../report-data-service/ReportDataService.ts";
import { InMemoryReportSnapshotStore } from "../../report-data-service/reportSnapshots.ts";
import { sampleTemplate } from "../../../src/data/sampleTemplate.ts";
import { evaluateReportReadiness } from "../../../src/report-engine/validation/reportValidation.ts";
import { buildPresentationModel } from "../../../src/report-engine/bindings/presentationModel.ts";
import { chronologicalQuarterWindow } from "../../../src/report-engine/charts/marketingChartScale.ts";

const marketRecord = (
  submarket: string,
  index: number,
  overrides: Partial<SalesforceRecord> = {},
): SalesforceRecord => ({
  Id: `market-${index}`,
  Name: `Q2 ${submarket}`,
  Market__c: null,
  Market_Code__c: null,
  Quarter_Label__c: "2026 Q2",
  Submarket__c: submarket,
  Inventory_SF__c: 1000,
  Delivered_SF__c: 10,
  Under_Construction_SF__c: 20,
  Under_Construction_Available_SF__c: 10,
  Total_Net_Absorption_SF__c: -25,
  Total_Vacant_SF__c: 49.6,
  Total_Vacant_Percent__c: 4.96,
  Total_Available_SF__c: 85.3,
  Total_Available_Percent__c: 8.53,
  Overall_Net_Rent_SF__c: 9.5,
  Sales_Volume_USD__c: 1_000_000,
  Total_Leasing_Activity_SF__c: 400,
  ...overrides,
});
const propertyRecord = (
  overrides: Partial<SalesforceRecord> = {},
): SalesforceRecord => ({
  Id: "property-data-1",
  Quarter__c: "2026 Q2",
  Property_Data_Scope__c: "Eligible 20K+ Market Universe",
  Submarket__c: "O'Hare",
  Market_Data__c: "market-13",
  Inventory_SF__c: 1000,
  Vacant_SF_Total__c: 50,
  Available_SF_Total__c: 100,
  Net_Absorption_SF_Total__c: 20,
  Leasing_Activity_SF_Total__c: 30,
  Deliveries_SF__c: 40,
  Under_Construction_SF__c: 200,
  Under_Construction_Available_SF__c: 50,
  Sales_Volume_USD__c: 500,
  ...overrides,
});

const quarterlyTotals = new Map([
  ["2026 Q2", 5_206_811],
  ["2026 Q1", 4_000_000],
  ["2025 Q4", 4_000_000],
  ["2025 Q3", 4_448_018],
  ["2025 Q2", 5_227_397],
  ["2025 Q1", 4_411_480],
  ["2024 Q4", -1_429_367],
  ["2024 Q3", -3_662_366],
]);
const centralQuarterly = new Map([
  ["2026 Q2", 126_800],
  ["2026 Q1", 50_000],
  ["2025 Q4", 50_000],
  ["2025 Q3", 38_671],
]);
const chicagoSouthQuarterly = new Map([
  ["2026 Q2", 37_457],
  ["2026 Q1", 100_000],
  ["2025 Q4", 100_000],
  ["2025 Q3", 171_747],
]);
const recordsForPeriod = (period: string) => {
  const total = quarterlyTotals.get(period)!;
  const central = centralQuarterly.get(period) ?? 0;
  const chicagoSouth = chicagoSouthQuarterly.get(period) ?? 0;
  const remainder = total - central - chicagoSouth;
  const base = Math.trunc(remainder / 16);
  return CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS.map((name, index) =>
    marketRecord(name, index, {
      Id:
        period === "2026 Q2"
          ? `market-${index}`
          : `market-${period.replace(/\W/g, "-")}-${index}`,
      Name: `${period} ${name}`,
      Quarter_Label__c: period,
      Total_Net_Absorption_SF__c:
        name === "Central DuPage"
          ? central
          : name === "Chicago South"
            ? chicagoSouth
            : index === CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS.length - 1
              ? remainder - base * 15
              : base,
    }),
  );
};

class FakeSalesforceClient implements SalesforceClient {
  readonly queries: string[] = [];
  constructor(
    private options: {
      invalidRate?: boolean;
      missingInventory?: boolean;
      missingRent?: boolean;
      missingSubmarket?: boolean;
      failedLeaseEnrichment?: boolean;
      leaseContributor?: SalesforceRecord;
      deliveryContributor?: SalesforceRecord;
      propertyEnrichment?: SalesforceRecord;
      btsLeaseRecords?: SalesforceRecord[];
      overallMarketRows?: SalesforceRecord[];
    } = {},
  ) {}
  async query<T extends SalesforceRecord>(soql: string): Promise<T[]> {
    this.queries.push(soql);
    if (soql.includes("FROM Market_Data_Contributor__c"))
      return [
        ...(this.options.leaseContributor ? [this.options.leaseContributor] : []),
        ...(this.options.deliveryContributor
          ? [this.options.deliveryContributor]
          : []),
      ] as T[];
    if (
      soql.includes("FROM ascendix__Property__c") &&
      this.options.propertyEnrichment
    )
      return [this.options.propertyEnrichment] as T[];
    if (
      soql.includes("FROM ascendix__Lease__c") &&
      soql.includes("ascendix__Property__c IN")
    )
      return (this.options.btsLeaseRecords ?? []) as T[];
    if (
      this.options.failedLeaseEnrichment &&
      soql.includes("FROM ascendix__Lease__c")
    )
      throw new Error("Simulated Lease enrichment failure");
    if (soql.includes("FROM Property_Data__c"))
      return CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS.map((name, index) =>
        propertyRecord({
          Id: `property-data-${index}`,
          Submarket__c: name,
          Market_Data__c: name === "Chicago South" ? null : `market-${index}`,
          Inventory_SF__c: name === "West Cook" ? 83_000 : 1000,
          Net_Absorption_SF_Total__c: index === 0 ? 5_206_471 : 20,
        }),
      ) as T[];
    if (
      soql.includes("FROM Market_Data__c") &&
      soql.includes("Geography_Code__c = 'OVERALL_MARKET'")
    )
      return structuredClone(this.options.overallMarketRows ?? []) as T[];
    if (soql.includes("FROM Market_Data__c")) {
      const rows = soql.includes("ORDER BY")
        ? [...quarterlyTotals.keys()].flatMap(recordsForPeriod)
        : recordsForPeriod("2026 Q2");
      Object.assign(rows[0], {
        Total_Vacant_Percent__c: this.options.invalidRate ? 140 : 4.5318549447,
      });
      if (this.options.missingInventory) delete rows[0].Inventory_SF__c;
      if (this.options.missingRent) rows[0].Overall_Net_Rent_SF__c = null;
      if (this.options.missingSubmarket) rows.pop();
      return rows as T[];
    }
    return [];
  }
  async health() {
    return { configured: true, connected: true };
  }
}
const request = {
  reportType: "industrial-market-report" as const,
  market: "Chicago",
  period: "2026Q2",
  calculationScope: { type: "all-submarkets" as const },
  timeContext: { type: "historical-period" as const, period: "2026Q2" },
};

describe("Salesforce Ascendix live-verified contract", () => {
  it("uses exact production API names", () => {
    expect(salesforceFieldMap.marketData.period.apiName).toBe(
      "Quarter_Label__c",
    );
    expect(salesforceFieldMap.marketData.quarterlyNetAbsorptionSf.apiName).toBe(
      "Total_Net_Absorption_SF__c",
    );
    expect(salesforceFieldMap.marketData.vacancyRate.apiName).toBe(
      "Total_Vacant_Percent__c",
    );
    expect(
      salesforceFieldMap.propertyData.quarterlyNetAbsorptionSf.apiName,
    ).toBe("Net_Absorption_SF_Total__c");
    expect(salesforceFieldMap.propertyData.leasingActivitySf.apiName).toBe(
      "Leasing_Activity_SF_Total__c",
    );
    expect(salesforceFieldMap.propertyData.deliveredSf.apiName).toBe(
      "Deliveries_SF__c",
    );
    expect(salesforceFieldMap.lease.object.apiName).toBe("ascendix__Lease__c");
    expect(salesforceFieldMap.sale.object.apiName).toBe("ascendix__Sale__c");
  });
  it("masks the native Tenant and blocks publication when Lease enrichment fails", async () => {
    const nativeTenant = "Native Tenant That Must Never Leak";
    const client = new FakeSalesforceClient({
      failedLeaseEnrichment: true,
      leaseContributor: {
        Id: "lease-contributor-unverified",
        Active_In_Run__c: true,
        Included_In_Report__c: true,
        Quarter_Label__c: "2026 Q2",
        Submarket__c: "O'Hare",
        Market_Data__c: "market-13",
        Contributor_Category__c: "Lease",
        Rank__c: 1,
        Sort_Value__c: 125_000,
        Lease_SF__c: 125_000,
        Lease__c: "lease-unverified",
        Is_Lee_Deal__c: true,
        Source_Record_ID__c: "lease-unverified",
        Tenant_Name__c: nativeTenant,
        Address__c: "200 Main St",
        Deal_Type__c: "New",
      },
    });
    const result = await new SalesforceAscendixReportAdapter(
      client,
      () => new Date("2026-08-20T12:00:00Z"),
    ).loadReportSource(request);

    expect(result.report.leasing[0]).toMatchObject({
      tenant: "(Confidential)",
      tenantDisplayName: "(Confidential)",
      isDealConfidential: null,
      isLeeDeal: null,
    });
    expect(JSON.stringify(result.report)).not.toContain(nativeTenant);
    expect(result.diagnostics).toContain(
      "Optional finalist enrichment unavailable for ascendix__Lease__c; contributor-native values were retained.",
    );
    expect(
      client.queries.find((query) => query.includes("FROM ascendix__Lease__c")),
    ).toContain("Lee_Deal__c");

    const readiness = evaluateReportReadiness(
      result.report,
      sampleTemplate,
      "ascendix",
    );
    expect(readiness.canExportDraft).toBe(true);
    expect(readiness.canPublish).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "leasing[0].isDealConfidential",
          level: "blocking",
        }),
      ]),
    );
  });
  it("loads exactly 18 Market_Data snapshots without Market__c and derives Overall Market from Property_Data", async () => {
    const client = new FakeSalesforceClient();
    const result = await new SalesforceAscendixReportAdapter(
      client,
      () => new Date("2026-08-20T12:00:00Z"),
    ).loadReportSource(request);
    expect(result.report.report.period).toBe("2026 Q2");
    expect(result.report.submarkets.map((row) => row.name)).toEqual(
      CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS,
    );
    expect(result.report.submarketDetails).toHaveLength(18);
    expect(result.report.submarketDetails[0]).toMatchObject({
      name: "Central DuPage",
      metrics: { quarterlyNetAbsorptionSf: 126_800 },
    });
    expect(
      result.report.submarketDetails[0].historicalPeriods[0],
    ).toMatchObject({
      period: "2026 Q2",
      quarterlyNetAbsorptionSf: 126_800,
    });
    expect(result.report.submarkets[0].vacancyRate).toBeCloseTo(0.045318549447);
    expect(result.report.overallMarket.inventorySf).toBe(100_000);
    expect(result.report.overallMarket.vacancyRate).toBeCloseTo(900 / 100_000);
    expect(result.report.overallMarket.speculativeShare).toBeCloseTo(
      900 / 3600,
    );
    expect(result.report.overallMarket.quarterlyNetAbsorptionSf).toBe(
      5_206_811,
    );
    expect(result.report.historicalPeriods[0]).toMatchObject({
      period: "2026 Q2",
      quarterlyNetAbsorptionSf: 5_206_811,
      trailing12MonthNetAbsorptionSf: 17_654_829,
      trailing12MonthNetAbsorptionStatus: "complete",
    });
    expect(
      result.report.historicalPeriods
        .slice(0, 5)
        .map((period) => period.trailing12MonthNetAbsorptionSf),
    ).toEqual([17_654_829, 17_675_415, 18_086_895, 12_657_528, 4_547_144]);
    expect(
      result.report.provenance.find(
        (item) =>
          item.fieldPath ===
          "historicalPeriods.2026 Q2.trailing12MonthNetAbsorptionSf",
      ),
    ).toMatchObject({
      metricType: "trailing-12-month",
      status: "calculated",
      calculation: {
        inputPeriods: ["2026 Q2", "2026 Q1", "2025 Q4", "2025 Q3"],
        inputCount: 4,
        sourceObjects: ["Market_Data__c"],
      },
    });
    expect(result.sourceDefinition?.headlineSource).toContain(
      "Property_Data__c",
    );
    expect(
      result.sourceDefinition?.propertyDataRollup?.unlinkedMarketDataRows,
    ).toBe(1);
    expect(
      result.report.submarkets.find((row) => row.name === "West Cook")
        ?.inventorySf,
    ).toBe(1000);
    expect(
      result.report.provenance.find(
        (item) =>
          item.fieldPath === "reconciliation.submarkets.West Cook.inventorySf",
      ),
    ).toMatchObject({
      status: "reconciled",
      selectedValue: 1000,
      critical: false,
      reconciliation: {
        classification: "known-difference",
        authoritativeValue: 1000,
        comparisonValue: 83_000,
        varianceAbsolute: 82_000,
      },
    });
    expect(
      result.report.submarkets.find((row) => row.name === "West Cook")
        ?.inventorySf,
    ).toBe(1000);
    expect(
      evaluateReportReadiness(result.report, sampleTemplate, "ascendix").issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "reconciliation.submarkets.West Cook.inventorySf",
          level: "warning",
        }),
      ]),
    );
    const currentQuery = client.queries.find(
      (query) =>
        query.includes("FROM Market_Data__c") && !query.includes("ORDER BY"),
    )!;
    expect(currentQuery).toContain("Quarter_Label__c = '2026 Q2'");
    expect(currentQuery).toContain("Submarket__c IN");
    expect(currentQuery).not.toContain("Market__c =");
    expect(client.queries.length).toBeLessThan(10);
  });
  it("reads market-explanation-v1 rows for submarkets and the Overall Market without altering existing sections", async () => {
    const explanation = (overrides: Record<string, unknown> & { Id: string }) => ({
      Active_In_Run__c: true,
      Included_In_Report__c: true,
      Quarter_Label__c: "2026 Q2",
      Rank__c: 1,
      Calculation_Version__c: "market-explanation-v1",
      ...overrides,
    });
    const client = new FakeSalesforceClient({
      leaseContributor: explanation({
        Id: "explanation-overall",
        Submarket__c: "Overall Market",
        Contributor_Category__c: "Vacancy Increase Driver",
        Metric_Value__c: 499_200,
        Display_Title__c: "1053 N Schmidt Rd",
        Narrative_Context__c: "1053 N Schmidt Rd added 499,200 SF of vacant space from Q1 to Q2.",
        Calc_Notes__c: JSON.stringify({
          version: "market-explanation-v1",
          driver_type: "unknown",
          evidence_strength: "indicative",
          change_sf: 499_200,
          overall_change_share_percent: 61.2,
          prior_snapshot_provenance: "legacy_unversioned_authoritative",
          comparison_warnings: ["Comparison quarter is legacy unversioned."],
        }),
      }),
      deliveryContributor: explanation({
        Id: "explanation-ohare",
        Submarket__c: "O'Hare",
        Contributor_Category__c: "Pipeline Delivery Driver",
        Metric_Value__c: -100_000,
        Sort_Value__c: 100_000,
        Display_Title__c: "Warehouse p4",
        Narrative_Context__c: "Warehouse p4 delivered 100,000 SF during Q2.",
        Calc_Notes__c: JSON.stringify({
          version: "market-explanation-v1",
          driver_type: "delivery",
          evidence_strength: "confirmed",
          construction_type: "Partial-Spec",
          pipeline_event_sf: 100_000,
        }),
      }),
    });
    const result = await new SalesforceAscendixReportAdapter(client).loadReportSource(request);
    expect(result.report.explanatoryFacts).toEqual([
      expect.objectContaining({
        factType: "vacancy_bridge",
        materialityPercent: 61.2,
        priorSnapshotProvenance: "legacy_unversioned_authoritative",
        trusted: true,
      }),
    ]);
    const ohare = result.report.submarketDetails.find((detail) => detail.name === "O'Hare");
    expect(ohare?.explanatoryFacts).toEqual([
      expect.objectContaining({ factType: "pipeline_change", constructionType: "Partial-Spec", evidenceStrength: "confirmed" }),
    ]);
    // A "Pipeline Delivery Driver" is never a Top Deliveries highlight.
    expect(ohare?.deliveries).toEqual([]);
    expect(result.report.deliveries).toEqual([]);
    const contributorQuery = client.queries.find((query) => query.includes("FROM Market_Data_Contributor__c"))!;
    expect(contributorQuery).toContain("'Overall Market'");
    for (const field of ["Rank_Basis__c", "Narrative_Context__c", "Calc_Notes__c"])
      expect(contributorQuery).toContain(field);
  });
  it("retains a null asking rent as the existing unavailable-value warning", async () => {
    const result = await new SalesforceAscendixReportAdapter(
      new FakeSalesforceClient({ missingRent: true }),
    ).loadReportSource(request);
    expect(result.report.submarkets[0]?.askingNetRentPsf).toBe(0);
    expect(
      evaluateReportReadiness(result.report, sampleTemplate, "ascendix").issues,
    ).toContainEqual(
      expect.objectContaining({
        path: "submarkets[0].askingNetRentPsf",
        level: "warning",
      }),
    );
  });
  it("keeps approved submarket quarterly and trailing-12-month values distinct", async () => {
    const adapter = new SalesforceAscendixReportAdapter(
      new FakeSalesforceClient(),
    );
    const central = await adapter.loadReportSource({
      ...request,
      calculationScope: {
        type: "selected-submarkets",
        submarkets: ["Central DuPage"],
      },
    });
    expect(central.report.overallMarket.quarterlyNetAbsorptionSf).toBe(126_800);
    expect(
      central.report.historicalPeriods[0].trailing12MonthNetAbsorptionSf,
    ).toBe(265_471);

    const chicagoSouth = await adapter.loadReportSource({
      ...request,
      calculationScope: {
        type: "selected-submarkets",
        submarkets: ["Chicago South"],
      },
    });
    expect(chicagoSouth.report.overallMarket.quarterlyNetAbsorptionSf).toBe(
      37_457,
    );
    expect(
      chicagoSouth.report.historicalPeriods[0].trailing12MonthNetAbsorptionSf,
    ).toBe(409_204);
  });
  it("fails explicitly for a missing standard snapshot and invalid metrics", async () => {
    await expect(
      new SalesforceAscendixReportAdapter(
        new FakeSalesforceClient({ missingSubmarket: true }),
      ).loadReportSource(request),
    ).rejects.toThrow("Missing: West Cook");
    await expect(
      new SalesforceAscendixReportAdapter(
        new FakeSalesforceClient({ invalidRate: true }),
      ).loadReportSource(request),
    ).rejects.toThrow("invalid vacancy rate");
    await expect(
      new SalesforceAscendixReportAdapter(
        new FakeSalesforceClient({ missingInventory: true }),
      ).loadReportSource(request),
    ).rejects.toThrow("missing inventory");
  });
  it("keeps current mode unsupported", async () => {
    await expect(
      new SalesforceAscendixReportAdapter(
        new FakeSalesforceClient(),
      ).loadReportSource({
        ...request,
        timeContext: { type: "current", asOf: "2026-08-20T12:00:00.000Z" },
      }),
    ).rejects.toThrow("Current Salesforce report mapping is not configured");
  });
  it("passes strict service validation and snapshots source-definition metadata", async () => {
    const service = new ReportDataService({
      ascendixAdapter: new SalesforceAscendixReportAdapter(
        new FakeSalesforceClient(),
      ),
      snapshotStore: new InMemoryReportSnapshotStore(),
      mode: "salesforce",
      now: () => new Date("2026-08-20T12:00:00.000Z"),
    });
    const result = await service.getIndustrialMarketReport({
      market: "Chicago",
      period: "Q2 2026",
      calculationScope: { type: "all-submarkets" },
    });
    expect(result.report.report.period).toBe("2026 Q2");
    // This fixture has no first-class Overall Market rows, so every quarter
    // is an explicitly diagnosed fallback (never silent equivalent authority).
    expect(result.sourceMetadata.sourceDefinition).toMatchObject({
      headlineSource: "Property_Data__c eligible 20K+ rollup",
    });
    expect(result.sourceMetadata.sourceDefinition!.trendSource).toMatch(
      /^OVERALL_MARKET_RECORD .*; SUBMARKET_ROLLUP_FALLBACK for /,
    );
    expect(
      result.report.provenance.find(
        (item) => item.fieldPath === "overallMarket.speculativeShare",
      ),
    ).toMatchObject({
      authority: "verified-derived Property_Data__c ratio-of-sums",
      critical: true,
    });
    expect(result.snapshot.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("resolves the Built-to-Suit tenant through a governed Property -> Lease lookup, never a fuzzy match", async () => {
    const client = new FakeSalesforceClient({
      deliveryContributor: {
        Id: "delivery-bts",
        Active_In_Run__c: true,
        Included_In_Report__c: true,
        Quarter_Label__c: "2026 Q2",
        Submarket__c: "O'Hare",
        Market_Data__c: "market-13",
        Contributor_Category__c: "Delivery",
        Rank__c: 1,
        Sort_Value__c: 250_000,
        Delivered_SF__c: 250_000,
        Property__c: "property-bts-1",
        Address__c: "500 Logistics Pkwy",
      },
      propertyEnrichment: {
        Id: "property-bts-1",
        ascendix__ExpansionType__c: "Built-to-Suit",
        ascendix__OwnerLandlord__r: { Name: "Owner Co" },
      },
      btsLeaseRecords: [
        {
          Id: "lease-bts-1",
          ascendix__Property__c: "property-bts-1",
          Is_Deal_Confidential__c: false,
          Deal_Type__c: "New",
          ascendix__Tenant__r: { Name: "CJ Logistics" },
        },
      ],
    });
    const result = await new SalesforceAscendixReportAdapter(
      client,
      () => new Date("2026-08-20T12:00:00Z"),
    ).loadReportSource(request);

    expect(result.report.deliveries[0]).toMatchObject({
      address: "500 Logistics Pkwy",
      displayParty: "CJ Logistics",
      displayPartySource: "tenant",
    });
    const leaseLookupQuery = client.queries.find(
      (query) =>
        query.includes("FROM ascendix__Lease__c") &&
        query.includes("ascendix__Property__c IN"),
    );
    expect(leaseLookupQuery).toBeDefined();
    expect(leaseLookupQuery).toContain("property-bts-1");
  });
});

describe("Top Sales size ranking and chart counts through the adapter", () => {
  // Price-ranked rows as the Market Data Engine publishes them today: the
  // contributor row itself carries no size for sales, so the adapter must
  // enrich every Sale before selecting by Sold SF.
  const saleRow = (
    id: string,
    submarket: string,
    marketIndex: number,
    rank: number,
    price: number,
  ): SalesforceRecord => ({
    Id: `sale-contributor-${id}`,
    Active_In_Run__c: true,
    Included_In_Report__c: true,
    Quarter_Label__c: "2026 Q2",
    Submarket__c: submarket,
    Market_Data__c: `market-${marketIndex}`,
    Contributor_Category__c: "Largest Sale",
    Rank_Basis__c: "Sale price descending, then sold SF descending",
    Rank__c: rank,
    Sort_Value__c: price,
    Metric_Value__c: price,
    Sale_Price__c: price,
    Building_SF__c: null,
    Sale__c: id,
    Address__c: `${id} Industrial Dr`,
  });
  const foxIndex = CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS.indexOf("Fox Valley");
  const i55Index = CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS.indexOf("I-55 Corridor");
  const contributors = [
    saleRow("fv-innovation", "Fox Valley", foxIndex, 1, 30_700_000),
    saleRow("fv-charles", "Fox Valley", foxIndex, 2, 29_100_000),
    saleRow("fv-kirk", "Fox Valley", foxIndex, 3, 17_250_000),
    saleRow("i55-remington", "I-55 Corridor", i55Index, 1, 86_500_000),
    saleRow("i55-davey", "I-55 Corridor", i55Index, 2, 62_350_000),
  ];
  const soldSf: Record<string, number> = {
    "fv-innovation": 250_100,
    "fv-charles": 258_720,
    "fv-kirk": 58_968,
    "i55-remington": 767_161,
    "i55-davey": 264_183,
  };
  class SalesClient extends FakeSalesforceClient {
    async query<T extends SalesforceRecord>(soql: string): Promise<T[]> {
      if (soql.includes("FROM Market_Data_Contributor__c")) {
        this.queries.push(soql);
        return contributors.map((row) => ({ ...row })) as T[];
      }
      if (soql.includes("FROM ascendix__Sale__c")) {
        this.queries.push(soql);
        return Object.entries(soldSf)
          .filter(([id]) => soql.includes(`'${id}'`))
          .map(([id, size]) => ({
            Id: id,
            Building_SF__c: size,
            Sale_Type__c: "Investment",
          })) as unknown as T[];
      }
      const rows = await super.query<T>(soql);
      if (soql.includes("FROM Market_Data__c"))
        rows.forEach((row, index) =>
          Object.assign(row, { Sales_Transactions__c: (index % 18) + 1 }),
        );
      return rows;
    }
  }

  it("enriches every published Sale and selects submarket and Overall Market Top Sales by Sold SF", async () => {
    const client = new SalesClient();
    const result = await new SalesforceAscendixReportAdapter(
      client,
      () => new Date("2026-08-20T12:00:00Z"),
    ).loadReportSource(request);
    const saleQuery = client.queries.find((query) =>
      query.includes("FROM ascendix__Sale__c"),
    )!;
    for (const id of Object.keys(soldSf)) expect(saleQuery).toContain(`'${id}'`);
    const fox = result.report.submarketDetails.find(
      (detail) => detail.name === "Fox Valley",
    )!;
    expect(fox.sales.map((item) => item.sizeSf)).toEqual([
      258_720, 250_100, 58_968,
    ]);
    expect(result.report.sales.map((item) => item.sizeSf)).toEqual([
      767_161, 264_183, 258_720,
    ]);
    expect(result.diagnostics.join("\n")).toContain(
      "Top Sales upstream contract mismatch",
    );
  });

  it("carries governed Sales transaction counts for submarkets and the Overall Market", async () => {
    const result = await new SalesforceAscendixReportAdapter(
      new SalesClient(),
      () => new Date("2026-08-20T12:00:00Z"),
    ).loadReportSource(request);
    // 18 submarket rows with counts 1..18 -> 171 for the summed Overall Market.
    expect(result.report.historicalPeriods[0]!.salesTransactions).toBe(171);
    const fox = result.report.submarketDetails.find(
      (detail) => detail.name === "Fox Valley",
    )!;
    expect(fox.historicalPeriods[0]!.salesTransactions).toBe(foxIndex + 1);
  });

  it("leaves the Overall Market count absent when the source does not publish it", async () => {
    const result = await new SalesforceAscendixReportAdapter(
      new FakeSalesforceClient(),
      () => new Date("2026-08-20T12:00:00Z"),
    ).loadReportSource(request);
    expect(result.report.historicalPeriods[0]!.salesTransactions).toBeUndefined();
  });
});

describe("first-class Overall Market Market_Data__c authority", () => {
  // Live Chicago OVERALL_MARKET rows (ids, External IDs and values as
  // published), including the authoritative historical nulls.
  const overallRow = (
    id: string,
    period: string,
    end: string,
    values: Partial<SalesforceRecord>,
  ): SalesforceRecord => ({
    Id: id,
    Name: id.slice(0, 15),
    External_Id__c: `OVERALL_MARKET::${end}`,
    Geography_Level__c: "Overall Market",
    Geography_Code__c: "OVERALL_MARKET",
    Market_Code__c: "CHI_IND",
    Submarket__c: null,
    Quarter_Label__c: period,
    Period_End__c: end,
    Inventory_SF__c: null,
    Delivered_SF__c: null,
    Under_Construction_SF__c: null,
    Under_Construction_Available_SF__c: null,
    Total_Net_Absorption_SF__c: null,
    Total_Vacant_SF__c: null,
    Total_Vacant_Percent__c: null,
    Total_Available_SF__c: null,
    Total_Available_Percent__c: null,
    Total_Leasing_Activity_SF__c: null,
    Sales_Volume_USD__c: null,
    Sales_Transactions__c: null,
    Median_Sales_Price_Per_Building_SF__c: null,
    Overall_Net_Rent_SF__c: null,
    ...values,
  });
  const OVERALL_ROWS = [
    overallRow("a1wVy0000095fyDIAQ", "2024 Q3", "2024-09-30", {
      Inventory_SF__c: 1238978430,
      Total_Vacant_Percent__c: 5.590406712972396,
      Total_Available_Percent__c: 8.591060939131928,
    }),
    overallRow("a1wVy0000095fzpIAA", "2024 Q4", "2024-12-31", {
      Inventory_SF__c: 1243529536,
      Total_Vacant_Percent__c: 5.5227602433883805,
      Total_Available_Percent__c: 8.903224515288072,
    }),
    overallRow("a1wVy0000095g1RIAQ", "2025 Q1", "2025-03-31", {
      Inventory_SF__c: 1246727292,
      Total_Vacant_Percent__c: 5.897402380760587,
      Total_Available_Percent__c: 9.001530865661037,
      Total_Net_Absorption_SF__c: 5450231,
      Total_Leasing_Activity_SF__c: 14084768,
      Delivered_SF__c: 3098226,
      Under_Construction_SF__c: 10723507,
      Sales_Volume_USD__c: 620746849,
      Sales_Transactions__c: 124,
    }),
    overallRow("a1wVy0000095g33IAA", "2025 Q2", "2025-06-30", {
      Inventory_SF__c: 1249113546,
      Total_Available_Percent__c: 8.931757994080709,
      Total_Net_Absorption_SF__c: 5227397,
      Total_Leasing_Activity_SF__c: 15845047,
      Delivered_SF__c: 2386254,
      Under_Construction_SF__c: 12423699,
      Sales_Volume_USD__c: 448294451,
      Sales_Transactions__c: 106,
    }),
    overallRow("a1wVy0000095XHVIA2", "2025 Q3", "2025-09-30", {
      Inventory_SF__c: 1250912204,
      Total_Vacant_Percent__c: 6.281051120035279,
      Total_Available_Percent__c: 9.055816918067258,
      Total_Net_Absorption_SF__c: 5045142,
      Total_Leasing_Activity_SF__c: 12688655,
      Delivered_SF__c: 1798658,
      Under_Construction_SF__c: 12864793,
      Sales_Volume_USD__c: 828006907,
      Sales_Transactions__c: 128,
      Median_Sales_Price_Per_Building_SF__c: 89.28,
    }),
    overallRow("a1wVy0000095XJ7IAM", "2025 Q4", "2025-12-31", {
      Inventory_SF__c: 1254468078,
      Total_Vacant_Percent__c: 6.149783031784727,
      Total_Available_Percent__c: 8.943756319321821,
      Total_Net_Absorption_SF__c: 2364125,
      Total_Leasing_Activity_SF__c: 13783974,
      Delivered_SF__c: 3555874,
      Under_Construction_SF__c: 12459437,
      Sales_Volume_USD__c: 1178864827.5,
      Sales_Transactions__c: 174,
      Median_Sales_Price_Per_Building_SF__c: 84.98,
    }),
    overallRow("a1wVy0000095QCoIAM", "2026 Q1", "2026-03-31", {
      Inventory_SF__c: 1256402186,
      Total_Vacant_Percent__c: 5.974294365005188,
      Total_Available_Percent__c: 8.846476091693141,
      Total_Net_Absorption_SF__c: 5038751,
      Total_Leasing_Activity_SF__c: 24335480,
      Delivered_SF__c: 2171896,
      Under_Construction_SF__c: 13111050,
      Sales_Volume_USD__c: 1043222978,
      Sales_Transactions__c: 152,
      Median_Sales_Price_Per_Building_SF__c: 99.62,
    }),
    overallRow("a1wVy0000095XMLIA2", "2026 Q2", "2026-06-30", {
      Inventory_SF__c: 1257981203,
      Total_Vacant_Percent__c: 4.836513385387618,
      Total_Available_Percent__c: 8.462573665339576,
      Total_Net_Absorption_SF__c: 5206811,
      Total_Leasing_Activity_SF__c: 14584206,
      Delivered_SF__c: 1651772,
      Under_Construction_SF__c: 13779195,
      Sales_Volume_USD__c: 1388155464,
      Sales_Transactions__c: 126,
      Median_Sales_Price_Per_Building_SF__c: 90.24,
    }),
    overallRow("a1wVy000008qTKfIAM", "2026 Q3", "2026-09-30", {
      Inventory_SF__c: 1261821655,
      Delivered_SF__c: 2077507,
      Under_Construction_SF__c: 17530947,
      Under_Construction_Available_SF__c: 4268333,
      Total_Net_Absorption_SF__c: 6807627,
      Total_Vacant_SF__c: 64235330.642441,
      Total_Vacant_Percent__c: 5.090682,
      Total_Available_SF__c: 104629779,
      Total_Available_Percent__c: 8.291963,
      Total_Leasing_Activity_SF__c: 16559754,
      Sales_Volume_USD__c: 1181229487.5,
      Sales_Transactions__c: 131,
      Median_Sales_Price_Per_Building_SF__c: 106,
      Overall_Net_Rent_SF__c: 8.06,
    }),
  ];
  const EXPECTED_IDS: Record<string, string> = {
    "2025 Q3": "a1wVy0000095XHVIA2",
    "2025 Q4": "a1wVy0000095XJ7IAM",
    "2026 Q1": "a1wVy0000095QCoIAM",
    "2026 Q2": "a1wVy0000095XMLIA2",
    "2026 Q3": "a1wVy000008qTKfIAM",
  };
  // Submarket fixture for 2026 Q3 (the shared fixture stops at 2026 Q2).
  const q3SubmarketRows = () =>
    recordsForPeriod("2026 Q2").map((row, index) => ({
      ...row,
      Id: `market-2026-Q3-${index}`,
      Name: `2026 Q3 ${row.Submarket__c}`,
      Quarter_Label__c: "2026 Q3",
      Total_Net_Absorption_SF__c: 111_111,
      Median_Sales_Price_Per_Building_SF__c: 777,
    }));
  class Q3Client extends FakeSalesforceClient {
    async query<T extends SalesforceRecord>(soql: string): Promise<T[]> {
      if (
        soql.includes("FROM Market_Data__c") &&
        !soql.includes("Geography_Code__c") &&
        soql.includes("Quarter_Label__c = '2026 Q3'")
      ) {
        this.queries.push(soql);
        return q3SubmarketRows() as unknown as T[];
      }
      const rows = await super.query<T>(soql);
      if (
        soql.includes("FROM Market_Data__c") &&
        !soql.includes("Geography_Code__c") &&
        soql.includes("ORDER BY")
      )
        return [...(q3SubmarketRows() as unknown as T[]), ...rows];
      return rows;
    }
  }
  const q3Request = {
    ...request,
    period: "2026Q3",
    timeContext: { type: "historical-period" as const, period: "2026Q3" },
  };
  const now = () => new Date("2026-10-02T12:00:00Z");
  const loadQ3 = (overallMarketRows: SalesforceRecord[] = OVERALL_ROWS) =>
    new SalesforceAscendixReportAdapter(
      new Q3Client({ overallMarketRows }),
      now,
    ).loadReportSource(q3Request);
  const period = (
    report: { historicalPeriods: Array<{ period: string }> },
    label: string,
  ) =>
    report.historicalPeriods.find((item) => item.period === label) as
      | (Record<string, unknown> & { period: string })
      | undefined;
  const provenanceFor = (
    report: { provenance: Array<{ fieldPath: string }> },
    path: string,
  ) =>
    report.provenance.find((item) => item.fieldPath === path) as
      | {
          authority: string;
          note?: string;
          sources: Array<{ sourceId: string; reference?: string }>;
        }
      | undefined;

  it("queries the Overall Market rows directly and separately from the submarket population", async () => {
    const client = new Q3Client({ overallMarketRows: OVERALL_ROWS });
    await new SalesforceAscendixReportAdapter(client, now).loadReportSource(
      q3Request,
    );
    const overallQuery = client.queries.find((query) =>
      query.includes("Geography_Code__c = 'OVERALL_MARKET'"),
    )!;
    expect(overallQuery).toContain(
      "Geography_Level__c = 'Overall Market' AND Geography_Code__c = 'OVERALL_MARKET'",
    );
    expect(overallQuery).toContain("External_Id__c");
    expect(overallQuery).toContain("Median_Sales_Price_Per_Building_SF__c");
    expect(overallQuery).not.toContain("Submarket__c IN");
  });

  it("1/12. chooses the first-class Overall row over the 18-submarket rollup, with exact record ids", async () => {
    const { report } = await loadQ3();
    // Fixture submarket rows sum to 4,000,000 for 2026 Q1; the Overall row says 5,038,751.
    expect(period(report, "2026 Q1")?.quarterlyNetAbsorptionSf).toBe(5_038_751);
    expect(period(report, "2026 Q3")?.quarterlyNetAbsorptionSf).toBe(6_807_627);
    for (const [label, id] of Object.entries(EXPECTED_IDS)) {
      expect(period(report, label)?.source).toMatchObject({
        authority: "OVERALL_MARKET_RECORD",
        quarter: label,
        externalIds: [OVERALL_ROWS.find((row) => row.Id === id)!.External_Id__c],
      });
      for (const metric of ["salesVolume", "medianSalesPricePsf", "vacancyRate", "quarterlyNetAbsorptionSf"]) {
        const record = provenanceFor(report, `historicalPeriods.${label}.${metric}`)!;
        expect(record.sources.map((source) => source.sourceId)).toEqual([id]);
        expect(record.authority).toMatch(/^OVERALL_MARKET_RECORD/);
      }
    }
    expect(
      report.historicalPeriods.every(
        (item) => item.source?.authority !== "SUBMARKET_ROLLUP_FALLBACK",
      ),
    ).toBe(true);
  });

  it("2/11. takes the current-quarter headline from a1wVy000008qTKfIAM, not Property_Data", async () => {
    const result = await loadQ3();
    expect(result.report.overallMarket).toMatchObject({
      inventorySf: 1_261_821_655,
      deliveredSf: 2_077_507,
      underConstructionSf: 17_530_947,
      quarterlyNetAbsorptionSf: 6_807_627,
      salesVolume: 1_181_229_487.5,
      askingNetRentPsf: 8.06,
    });
    expect(result.report.overallMarket.vacancyRate).toBeCloseTo(0.05090682, 10);
    expect(result.report.overallMarket.speculativeShare).toBeCloseTo(
      4_268_333 / 17_530_947,
      10,
    );
    for (const key of ["inventorySf", "askingNetRentPsf", "salesVolume"]) {
      const record = provenanceFor(result.report, `overallMarket.${key}`)!;
      expect(record.authority).toMatch(/^OVERALL_MARKET_RECORD/);
      expect(record.sources[0]!.sourceId).toBe("a1wVy000008qTKfIAM");
    }
    expect(result.sourceDefinition.headlineSource).toMatch(
      /^OVERALL_MARKET_RECORD: .*OVERALL_MARKET::2026-09-30/,
    );
  });

  it("3. keeps the Overall row as authority through ReportDataService and renders Market Totals from report.overallMarket", async () => {
    const service = new ReportDataService({
      ascendixAdapter: new SalesforceAscendixReportAdapter(
        new Q3Client({ overallMarketRows: OVERALL_ROWS }),
        now,
      ),
      snapshotStore: new InMemoryReportSnapshotStore(),
      mode: "salesforce",
    });
    const result = await service.getIndustrialMarketReport(q3Request);
    expect(result.report.overallMarket.askingNetRentPsf).toBe(8.06);
    const rent = result.report.provenance.find(
      (item) => item.fieldPath === "overallMarket.askingNetRentPsf",
    )!;
    expect(rent.authority).toMatch(/^OVERALL_MARKET_RECORD/);
    expect(rent.status).toBe("matched");
    const presentation = buildPresentationModel({
      ...result.report,
      overallMarket: { ...result.report.overallMarket, narrative: "" },
      submarketDetails: result.report.submarketDetails.map((detail) => ({
        ...detail,
        narrative: "",
      })),
    });
    const totals = presentation.submarketTableRows.find(
      (row) => row.kind === "total",
    )!;
    expect(totals).toMatchObject({
      inventory: "1,261,821,655",
      delivered: "2,077,507",
      underConstruction: "17,530,947",
      absorption: "6,807,627",
      vacancy: "5.09%",
      availability: "8.29%",
      rent: "$8.06",
      sales: "$1,181,229,488",
    });
  });

  it("4/5. feeds the charts directly, including Median Sales Price / SF from the single Overall row", async () => {
    const service = new ReportDataService({
      ascendixAdapter: new SalesforceAscendixReportAdapter(
        new Q3Client({ overallMarketRows: OVERALL_ROWS }),
        now,
      ),
      snapshotStore: new InMemoryReportSnapshotStore(),
      mode: "salesforce",
    });
    const { report } = await service.getIndustrialMarketReport(q3Request);
    const chart = chronologicalQuarterWindow(
      report.historicalPeriods,
      (row) => row.period,
    );
    expect(
      chart.map((row) => [
        row.period,
        row.salesVolume,
        row.medianSalesPricePsf,
        row.source?.externalIds?.[0],
      ]),
    ).toEqual([
      ["2025 Q3", 828_006_907, 89.28, "OVERALL_MARKET::2025-09-30"],
      ["2025 Q4", 1_178_864_827.5, 84.98, "OVERALL_MARKET::2025-12-31"],
      ["2026 Q1", 1_043_222_978, 99.62, "OVERALL_MARKET::2026-03-31"],
      ["2026 Q2", 1_388_155_464, 90.24, "OVERALL_MARKET::2026-06-30"],
      ["2026 Q3", 1_181_229_487.5, 106, "OVERALL_MARKET::2026-09-30"],
    ]);
  });

  it("6/9/13. keeps authoritative nulls null and never field-level backfills from submarkets", async () => {
    const { report } = await loadQ3();
    // The 2026 Q3 submarket fixture rows carry a median of 777; it is ignored.
    expect(period(report, "2026 Q3")?.medianSalesPricePsf).toBe(106);
    const q2_2025 = period(report, "2025 Q2")!;
    expect(q2_2025.medianSalesPricePsf).toBeNull();
    expect(q2_2025.vacancyRate).toBeNull();
    expect(q2_2025.availabilityRate).toBeCloseTo(0.08931757994080709, 12);
    expect(q2_2025.source).toMatchObject({
      authority: "OVERALL_MARKET_RECORD",
      authoritativeNulls: expect.arrayContaining([
        "vacancyRate",
        "medianSalesPricePsf",
      ]),
    });
    const vacancy = provenanceFor(report, "historicalPeriods.2025 Q2.vacancyRate")!;
    expect(vacancy.sources.map((source) => source.sourceId)).toEqual([
      "a1wVy0000095g33IAA",
    ]);
    expect(vacancy.note).toMatch(/^AUTHORITATIVE_NULL/);
  });

  it("14. preserves the 2024 Q4 authoritative absorption null instead of the submarket sum", async () => {
    const { report } = await loadQ3();
    // The fixture's 2024 Q4 submarket rows sum to -1,429,367.
    const q4_2024 = period(report, "2024 Q4")!;
    expect(q4_2024.quarterlyNetAbsorptionSf).toBeNull();
    expect(q4_2024.underConstructionSf).toBeNull();
    expect(q4_2024.leasingActivitySf).toBeNull();
    expect(q4_2024.salesVolume).toBeNull();
  });

  it("7/8 (T12). computes trailing 12 months from Overall rows and leaves it unavailable across an authoritative null", async () => {
    const { report } = await loadQ3();
    expect(period(report, "2026 Q3")).toMatchObject({
      trailing12MonthNetAbsorptionSf: 6_807_627 + 5_206_811 + 5_038_751 + 2_364_125,
      trailing12MonthNetAbsorptionStatus: "complete",
    });
    // 2025 Q3 needs 2024 Q4, which exists with an authoritative null.
    expect(period(report, "2025 Q3")).toMatchObject({
      trailing12MonthNetAbsorptionSf: null,
      trailing12MonthNetAbsorptionStatus: "authoritative_null",
    });
    expect(
      provenanceFor(report, "historicalPeriods.2025 Q3.trailing12MonthNetAbsorptionSf")!.note,
    ).toMatch(/^AUTHORITATIVE_NULL: 2024 Q4/);
  });

  it("maps all five Q3 2026 Overall Market T12 indicator columns without replacing the oldest authoritative null", async () => {
    const { report } = await loadQ3();
    const expected = [19_417_314, 17_654_829, 17_675_415, 18_086_895, null];
    expect(report.historicalPeriods.slice(0, 5).map((item) => item.period))
      .toEqual(["2026 Q3", "2026 Q2", "2026 Q1", "2025 Q4", "2025 Q3"]);
    expect(report.historicalPeriods.slice(0, 5).map((item) => item.trailing12MonthNetAbsorptionSf))
      .toEqual(expected);
    const row = buildPresentationModel(report).indicatorRows.find((item) => item.metric.includes("12 Month Net Absorption"))!;
    expect([row.q2, row.q1, row.q4, row.q3, row.prior])
      .toEqual(["19,417,314", "17,654,829", "17,675,415", "18,086,895", "—"]);
    for (const label of ["2025 Q3", "2025 Q2"]) {
      expect(period(report, label)!.trailing12MonthNetAbsorptionStatus).toBe("authoritative_null");
    }
    // This fixture stops at 2024 Q3, so Q1 2025 lacks Q2 2024 entirely.
    expect(period(report, "2025 Q1")!.trailing12MonthNetAbsorptionStatus).toBe("insufficient_history");
    expect(report.provenance.find((item) => item.fieldPath === "historicalPeriods.2025 Q3.trailing12MonthNetAbsorptionSf")!.calculation!.inputPeriods)
      .toEqual(["2025 Q3", "2025 Q2", "2025 Q1", "2024 Q4"]);
    expect(period(report, "2024 Q4")!.quarterlyNetAbsorptionSf).toBeNull();
    expect(report.overallMarket.quarterlyNetAbsorptionSf).toBe(6_807_627);
    const presentation = buildPresentationModel(report);
    for (const detail of report.submarketDetails) {
      const presented = presentation.submarketDetails.find((item) => item.id === detail.id)!;
      const indicator = presented.indicatorRows.find((item) => item.metric.includes("12 Month Net Absorption"))!;
      expect([indicator.q2, indicator.q1, indicator.q4, indicator.q3, indicator.prior])
        .toEqual(detail.historicalPeriods.slice(0, 5).map((item) =>
          item.trailing12MonthNetAbsorptionSf == null ? "—" : item.trailing12MonthNetAbsorptionSf.toLocaleString("en-US")));
    }
  });

  it("8. uses a diagnosed SUBMARKET_ROLLUP_FALLBACK only when an entire Overall quarter row is missing", async () => {
    const result = await loadQ3(
      OVERALL_ROWS.filter((row) => row.Quarter_Label__c !== "2026 Q1"),
    );
    const q1 = period(result.report, "2026 Q1")!;
    expect(q1.source).toMatchObject({ authority: "SUBMARKET_ROLLUP_FALLBACK" });
    expect(q1.quarterlyNetAbsorptionSf).toBe(4_000_000);
    expect(
      provenanceFor(result.report, "historicalPeriods.2026 Q1.salesVolume")!.authority,
    ).toMatch(/^SUBMARKET_ROLLUP_FALLBACK/);
    expect(result.diagnostics.join("\n")).toMatch(
      /SUBMARKET_ROLLUP_FALLBACK: no first-class OVERALL_MARKET Market_Data__c row exists for 2026 Q1/,
    );
    // Every other quarter is still the Overall row.
    expect(
      (period(result.report, "2026 Q2")?.source as { authority?: string } | undefined)
        ?.authority,
    ).toBe(
      "OVERALL_MARKET_RECORD",
    );
  });

  it("indicator arrows compare Overall current vs Overall prior quarter", async () => {
    const { report } = await loadQ3();
    const presentation = buildPresentationModel({
      ...report,
      overallMarket: { ...report.overallMarket, narrative: "" },
      submarketDetails: [],
    } as never) as unknown as {
      indicatorRows: Array<{ metricKey: string; direction: string; q2: string; q1: string }>;
    };
    const vacancy = presentation.indicatorRows.find((row) => row.metricKey === "vacancyRate")!;
    expect(vacancy).toMatchObject({ q2: "5.09%", q1: "4.84%", direction: "up" });
    const construction = presentation.indicatorRows.find(
      (row) => row.metricKey === "underConstructionSf",
    )!;
    expect(construction).toMatchObject({ q2: "17,530,947", q1: "13,779,195", direction: "up" });
  });

  it("10. leaves submarket reports and submarket detail pages unchanged", async () => {
    const single = {
      ...q3Request,
      calculationScope: {
        type: "selected-submarkets" as const,
        submarkets: ["Central DuPage"],
      },
    };
    const withOverall = await new SalesforceAscendixReportAdapter(
      new Q3Client({ overallMarketRows: OVERALL_ROWS }),
      now,
    ).loadReportSource(single);
    const withoutOverall = await new SalesforceAscendixReportAdapter(
      new Q3Client({ overallMarketRows: [] }),
      now,
    ).loadReportSource(single);
    expect(withOverall.report).toEqual(withoutOverall.report);
    expect(withOverall.report.historicalPeriods.every((item) => !item.source)).toBe(true);
    const full = await loadQ3();
    const fullWithout = await loadQ3([]);
    expect(full.report.submarketDetails).toEqual(fullWithout.report.submarketDetails);
    expect(full.report.submarkets).toEqual(fullWithout.report.submarkets);
  });

  describe("Overall Market asking rent authoritative null", () => {
    const nullRentRows = () =>
      OVERALL_ROWS.map((row) =>
        row.Quarter_Label__c === "2026 Q3"
          ? { ...row, Overall_Net_Rent_SF__c: null }
          : row,
      );
    const serviceFor = (rows: SalesforceRecord[]) =>
      new ReportDataService({
        ascendixAdapter: new SalesforceAscendixReportAdapter(
          new Q3Client({ overallMarketRows: rows }),
          now,
        ),
        snapshotStore: new InMemoryReportSnapshotStore(),
        mode: "salesforce",
      });
    const totalsRow = (report: Parameters<typeof buildPresentationModel>[0]) =>
      buildPresentationModel({
        ...report,
        overallMarket: { ...report.overallMarket, narrative: "" },
        submarketDetails: report.submarketDetails.map((detail) => ({
          ...detail,
          narrative: "",
        })),
      }).submarketTableRows.find((row) => row.kind === "total")!;

    it("R1. an Overall row with a null Overall_Net_Rent_SF__c yields a null report value", async () => {
      const source = await loadQ3(nullRentRows());
      expect(source.report.overallMarket.askingNetRentPsf).toBeNull();
      const rent = provenanceFor(source.report, "overallMarket.askingNetRentPsf")!;
      expect(rent.authority).toMatch(/^OVERALL_MARKET_RECORD/);
      expect(rent.sources.map((item) => item.sourceId)).toEqual([
        "a1wVy000008qTKfIAM",
      ]);
      const result = await serviceFor(nullRentRows()).getIndustrialMarketReport(
        q3Request,
      );
      expect(result.report.overallMarket.askingNetRentPsf).toBeNull();
    });

    it("R2. presentation renders the unavailable state, not $0", async () => {
      const { report } = await serviceFor(
        nullRentRows(),
      ).getIndustrialMarketReport(q3Request);
      const totals = totalsRow(report);
      expect(totals.rent).toBe("—");
      expect(totals.rent).not.toMatch(/\$0/);
      // Every other Market Totals column is still the Overall row.
      expect(totals).toMatchObject({
        inventory: "1,261,821,655",
        sales: "$1,181,229,488",
      });
    });

    it("R3. an Overall row with 8.06 renders $8.06", async () => {
      const { report } = await serviceFor(OVERALL_ROWS).getIndustrialMarketReport(
        q3Request,
      );
      expect(report.overallMarket.askingNetRentPsf).toBe(8.06);
      expect(totalsRow(report).rent).toBe("$8.06");
    });

    it("R4. never field-level backfills a null Overall rent from submarket rent or Property_Data", async () => {
      const source = await loadQ3(nullRentRows());
      // Every fixture submarket publishes $9.50 rent, which is also what the
      // inventory-weighted submarket and Property_Data rollups would produce.
      expect(new Set(source.report.submarkets.map((row) => row.askingNetRentPsf))).toEqual(
        new Set([9.5]),
      );
      expect(source.report.overallMarket.askingNetRentPsf).not.toBe(9.5);
      expect(source.report.overallMarket.askingNetRentPsf).not.toBe(0);
      expect(source.report.overallMarket.askingNetRentPsf).toBeNull();
      expect(source.sourceDefinition.headlineSource).toMatch(
        /^OVERALL_MARKET_RECORD/,
      );
      expect(source.diagnostics.join("\n")).not.toMatch(/FALLBACK/);
      // Submarket rent behavior is unchanged.
      const withRent = await loadQ3(OVERALL_ROWS);
      expect(source.report.submarkets).toEqual(withRent.report.submarkets);
    });
  });

  it("fails closed on two Overall rows for the same quarter", async () => {
    await expect(
      loadQ3([...OVERALL_ROWS, { ...OVERALL_ROWS.at(-1)!, Id: "a1wDuplicateOverall" }]),
    ).rejects.toThrow(/more than one OVERALL_MARKET row for 2026 Q3/);
  });
});
