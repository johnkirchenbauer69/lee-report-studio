import { describe, expect, it } from "vitest";
import type {
  SalesforceClient,
  SalesforceRecord,
} from "../salesforce/SalesforceClient.ts";
import {
  salesforceFieldMap,
  PUBLIC_EXCLUDED_SUBMARKETS,
} from "./salesforceFieldMap.ts";
import { SalesforceAscendixReportAdapter } from "./SalesforceAscendixReportAdapter.ts";

const metricRecord = (
  overrides: Partial<SalesforceRecord> = {},
): SalesforceRecord => ({
  Id: "market-aggregate",
  Name: "Overall",
  Market__c: "Chicago",
  Quarter_Label__c: "2026 Q2",
  Submarket__c: null,
  Inventory_SF__c: 1000,
  Delivered_SF__c: 10,
  Under_Construction_SF__c: 20,
  Under_Construction_Available_SF__c: 10,
  Total_Net_Absorption_SF__c: -25,
  Total_Vacant_Percent__c: 4.96,
  Total_Available_Percent__c: 8.53,
  Overall_Net_Rent_SF__c: 9.5,
  Sales_Volume_USD__c: 1_000_000,
  Total_Leasing_Activity_SF__c: 400,
  ...overrides,
});
class FakeSalesforceClient implements SalesforceClient {
  queries: string[] = [];
  constructor(
    private invalidRate = false,
    private missingInventory = false,
  ) {}
  async query<T extends SalesforceRecord>(soql: string): Promise<T[]> {
    this.queries.push(soql);
    if (soql.includes("FROM Market_Data_Contributor__c")) return [];
    if (
      soql.includes("FROM Market_Data__c") &&
      soql.includes("ORDER BY Quarter_Label__c")
    )
      return [metricRecord()] as T[];
    if (soql.includes("FROM Market_Data__c")) {
      const aggregate = metricRecord({
        Total_Vacant_Percent__c: this.invalidRate ? 140 : 4.96,
      });
      if (this.missingInventory) delete aggregate.Inventory_SF__c;
      return [
        aggregate,
        metricRecord({ Id: "included", Submarket__c: "O'Hare" }),
        ...PUBLIC_EXCLUDED_SUBMARKETS.map((name, index) =>
          metricRecord({
            Id: `excluded-${index}`,
            Submarket__c: ` ${name.toUpperCase()} `,
          }),
        ),
        metricRecord({ Id: "duplicate-total", Submarket__c: "Overall Market" }),
      ] as T[];
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

describe("Salesforce Ascendix verified contract", () => {
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
    expect(salesforceFieldMap.marketData.availabilityRate.apiName).toBe(
      "Total_Available_Percent__c",
    );
    expect(salesforceFieldMap.marketData.askingNetRentPsf.apiName).toBe(
      "Overall_Net_Rent_SF__c",
    );
    expect(salesforceFieldMap.marketData.salesVolume.apiName).toBe(
      "Sales_Volume_USD__c",
    );
    expect(salesforceFieldMap.lease.object.apiName).toBe("ascendix__Lease__c");
    expect(salesforceFieldMap.sale.object.apiName).toBe("ascendix__Sale__c");
  });
  it("normalizes rates, excludes all seven public exclusions, and omits unverified narrative", async () => {
    const client = new FakeSalesforceClient();
    const result = await new SalesforceAscendixReportAdapter(
      client,
      () => new Date("2026-08-20T12:00:00Z"),
    ).loadReportSource(request);
    expect(result.report.report.period).toBe("2026 Q2");
    expect(result.report.overallMarket.vacancyRate).toBe(0.0496);
    expect(result.report.submarkets.map((row) => row.name)).toEqual(["O'Hare"]);
    expect(result.report.overallMarket.narrative).toBe("");
    expect(result.report.overallMarket.speculativeShare).toBe(0.5);
    expect(
      client.queries.find(
        (query) =>
          query.includes("FROM Market_Data__c") && !query.includes("ORDER BY"),
      ),
    ).toContain("Quarter_Label__c = '2026 Q2'");
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
  it("rejects invalid normalized rates and missing required metrics", async () => {
    await expect(
      new SalesforceAscendixReportAdapter(
        new FakeSalesforceClient(true),
      ).loadReportSource(request),
    ).rejects.toThrow("invalid vacancy rate");
    await expect(
      new SalesforceAscendixReportAdapter(
        new FakeSalesforceClient(false, true),
      ).loadReportSource(request),
    ).rejects.toThrow("missing inventory");
  });
});
