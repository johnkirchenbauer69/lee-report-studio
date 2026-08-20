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
  Net_Absorption_SF__c: 20,
  Leasing_Activity_SF__c: 30,
  Delivered_SF__c: 40,
  Under_Construction_SF__c: 200,
  Under_Construction_Available_SF__c: 50,
  Sales_Volume_USD__c: 500,
  ...overrides,
});

class FakeSalesforceClient implements SalesforceClient {
  readonly queries: string[] = [];
  constructor(
    private options: {
      invalidRate?: boolean;
      missingInventory?: boolean;
      missingSubmarket?: boolean;
    } = {},
  ) {}
  async query<T extends SalesforceRecord>(soql: string): Promise<T[]> {
    this.queries.push(soql);
    if (soql.includes("FROM Market_Data_Contributor__c")) return [];
    if (soql.includes("FROM Property_Data__c"))
      return CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS.map((name, index) =>
        propertyRecord({
          Id: `property-data-${index}`,
          Submarket__c: name,
          Market_Data__c: name === "Chicago South" ? null : `market-${index}`,
          Inventory_SF__c: name === "West Cook" ? 83_000 : 1000,
        }),
      ) as T[];
    if (soql.includes("FROM Market_Data__c")) {
      const rows = CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS.map((name, index) =>
        marketRecord(
          name,
          index,
          index === 0
            ? {
                Total_Vacant_Percent__c: this.options.invalidRate
                  ? 140
                  : 4.5318549447,
              }
            : {},
        ),
      );
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
    expect(salesforceFieldMap.marketData.netAbsorptionSf.apiName).toBe(
      "Total_Net_Absorption_SF__c",
    );
    expect(salesforceFieldMap.marketData.vacancyRate.apiName).toBe(
      "Total_Vacant_Percent__c",
    );
    expect(salesforceFieldMap.lease.object.apiName).toBe("ascendix__Lease__c");
    expect(salesforceFieldMap.sale.object.apiName).toBe("ascendix__Sale__c");
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
    expect(result.report.submarkets[0].vacancyRate).toBeCloseTo(0.045318549447);
    expect(result.report.overallMarket.inventorySf).toBe(100_000);
    expect(result.report.overallMarket.vacancyRate).toBeCloseTo(900 / 100_000);
    expect(result.report.overallMarket.speculativeShare).toBeCloseTo(
      900 / 3600,
    );
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
    });
    const currentQuery = client.queries.find(
      (query) =>
        query.includes("FROM Market_Data__c") && !query.includes("ORDER BY"),
    )!;
    expect(currentQuery).toContain("Quarter_Label__c = '2026 Q2'");
    expect(currentQuery).toContain("Submarket__c IN");
    expect(currentQuery).not.toContain("Market__c =");
    expect(client.queries.length).toBeLessThan(10);
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
