import { describe, expect, it } from "vitest";
import type {
  SalesforceClient,
  SalesforceRecord,
} from "../salesforce/SalesforceClient.ts";
import { SalesforceAscendixReportAdapter } from "./SalesforceAscendixReportAdapter.ts";

const metricRecord = (
  overrides: Partial<SalesforceRecord> = {},
): SalesforceRecord => ({
  Id: "market-aggregate",
  Market__c: "Chicago",
  Period__c: "2026 Q2",
  Submarket__c: null,
  Inventory_SF__c: 1000,
  Delivered_SF__c: 10,
  Under_Construction_SF__c: 20,
  Speculative_Share__c: 0.5,
  Net_Absorption_SF__c: -25,
  Vacancy_Rate__c: 0.1,
  Availability_Rate__c: 0.2,
  Asking_Net_Rent_PSF__c: 9.5,
  Sales_Volume__c: 1_000_000,
  Leasing_Activity_SF__c: 400,
  Narrative__c: "Historical narrative",
  ...overrides,
});

class FakeSalesforceClient implements SalesforceClient {
  readonly queries: string[] = [];
  constructor(private readonly invalidRate = false) {}
  async query<T extends SalesforceRecord>(soql: string): Promise<T[]> {
    this.queries.push(soql);
    if (
      soql.includes("FROM Market_Data__c") &&
      soql.includes("ORDER BY Period__c")
    ) {
      return [metricRecord()] as T[];
    }
    if (soql.includes("FROM Market_Data__c")) {
      return [
        metricRecord({ Vacancy_Rate__c: this.invalidRate ? 1.4 : 0.1 }),
        metricRecord({ Id: "market-ohare", Submarket__c: "O'Hare" }),
      ] as T[];
    }
    if (soql.includes("FROM Lease__c")) {
      return [
        {
          Id: "lease-1",
          Tenant_Name__c: "Tenant",
          Size_SF__c: 250,
          Property_Address__c: "1 Main St",
          Lease_Type__c: "New",
        },
      ] as unknown as T[];
    }
    if (soql.includes("FROM Property_Data__c")) {
      return [
        {
          Id: "sale-1",
          Buyer__c: "Buyer",
          Sale_Price__c: 500000,
          Property_Address__c: "2 Main St",
          Sale_Type__c: "Investment",
        },
      ] as unknown as T[];
    }
    return [];
  }
  async health() {
    return { configured: true, connected: true };
  }
}

class MissingFieldSalesforceClient extends FakeSalesforceClient {
  override async query<T extends SalesforceRecord>(soql: string): Promise<T[]> {
    const records = await super.query<T>(soql);
    if (
      soql.includes("FROM Market_Data__c") &&
      !soql.includes("ORDER BY Period__c")
    ) {
      delete records[0].Inventory_SF__c;
    }
    return records;
  }
}

const request = {
  reportType: "industrial-market-report" as const,
  market: "Chicago",
  period: "2026 Q2",
  calculationScope: { type: "all-submarkets" as const },
  timeContext: { type: "historical-period" as const, period: "2026 Q2" },
};

describe("Salesforce Ascendix adapter contract", () => {
  it("maps period records, details, provenance, and market filters", async () => {
    const client = new FakeSalesforceClient();
    const result = await new SalesforceAscendixReportAdapter(
      client,
      () => new Date("2026-08-20T12:00:00.000Z"),
    ).loadReportSource(request);
    expect(result.report.submarkets[0]).toMatchObject({
      name: "O'Hare",
      netAbsorptionSf: -25,
    });
    expect(result.report.historicalPeriods[0].period).toBe("2026 Q2");
    expect(result.report.leasing[0].tenant).toBe("Tenant");
    expect(result.report.sales[0].buyer).toBe("Buyer");
    expect(result.report.provenance).toContainEqual(
      expect.objectContaining({
        fieldPath: "submarkets.O'Hare.vacancyRate",
        sources: [
          expect.objectContaining({
            sourceId: "market-ohare",
            sourceType: "salesforce",
            importedAt: "2026-08-20T12:00:00.000Z",
          }),
        ],
      }),
    );
    expect(
      client.queries.every(
        (query) =>
          query.includes("Market__c = 'Chicago'") ||
          !query.includes("Market_Data__c"),
      ),
    ).toBe(true);
  });

  it("keeps current and historical pathways explicit", async () => {
    await expect(
      new SalesforceAscendixReportAdapter(
        new FakeSalesforceClient(),
      ).loadReportSource({
        ...request,
        timeContext: { type: "current", asOf: "2026-08-20T12:00:00.000Z" },
      }),
    ).rejects.toThrow("Current Salesforce report mapping is not configured");
  });

  it("rejects invalid source rates instead of substituting data", async () => {
    await expect(
      new SalesforceAscendixReportAdapter(
        new FakeSalesforceClient(true),
      ).loadReportSource(request),
    ).rejects.toThrow("invalid vacancy rate");
  });

  it("rejects missing required metric fields instead of coercing them to zero", async () => {
    await expect(
      new SalesforceAscendixReportAdapter(
        new MissingFieldSalesforceClient(),
      ).loadReportSource(request),
    ).rejects.toThrow("missing inventory");
  });
});
