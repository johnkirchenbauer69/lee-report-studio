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
      missingSubmarket?: boolean;
      failedLeaseEnrichment?: boolean;
      leaseContributor?: SalesforceRecord;
    } = {},
  ) {}
  async query<T extends SalesforceRecord>(soql: string): Promise<T[]> {
    this.queries.push(soql);
    if (soql.includes("FROM Market_Data_Contributor__c"))
      return (
        this.options.leaseContributor ? [this.options.leaseContributor] : []
      ) as T[];
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
    if (soql.includes("FROM Market_Data__c")) {
      const rows = soql.includes("ORDER BY")
        ? [...quarterlyTotals.keys()].flatMap(recordsForPeriod)
        : recordsForPeriod("2026 Q2");
      Object.assign(rows[0], {
        Total_Vacant_Percent__c: this.options.invalidRate ? 140 : 4.5318549447,
      });
      if (this.options.missingInventory) delete rows[0].Inventory_SF__c;
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
    });
    expect(JSON.stringify(result.report)).not.toContain(nativeTenant);
    expect(result.diagnostics).toContain(
      "Optional finalist enrichment unavailable for ascendix__Lease__c; contributor-native values were retained.",
    );

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
    expect(result.sourceMetadata.sourceDefinition).toMatchObject({
      headlineSource: "Property_Data__c eligible 20K+ rollup",
      trendSource: "18 Market_Data__c submarket snapshots",
    });
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
});
