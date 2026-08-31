import { describe, expect, it } from "vitest";
import { formatReportValue } from "../../../src/report-engine/formatting/formatValue.ts";
import {
  aggregateAvailabilityBySize,
  aggregateQuarterlyMarketPeriod,
  calculateTrailing12MonthNetAbsorption,
  rollupPropertyData,
  verifiedSpeculativeShare,
} from "./salesforceRollups.ts";

const market = (
  name: string,
  inventorySf: number,
  askingNetRentPsf: number,
) => ({
  name,
  inventorySf,
  askingNetRentPsf,
  deliveredSf: 0,
  underConstructionSf: 0,
  speculativeShare: 0,
  quarterlyNetAbsorptionSf: 0,
  vacancyRate: 0,
  availabilityRate: 0,
  salesVolume: 0,
});
describe("live-verified Salesforce rollups", () => {
  it("buckets Property_Data availability with exact half-open boundaries", () => {
    const rows = [
      20_000, 74_999, 75_000, 149_999, 150_000, 249_999, 250_000, 499_999,
      500_000,
    ].map((value, index) => ({
      Id: `row-${index}`,
      Available_SF_Total__c: value,
    }));
    expect(aggregateAvailabilityBySize(rows)).toEqual([
      { bucket: "20-75k SF", availableSf: 94_999, buildingCount: 2 },
      { bucket: "75-150k SF", availableSf: 224_999, buildingCount: 2 },
      { bucket: "150-250k SF", availableSf: 399_999, buildingCount: 2 },
      { bucket: "250-500k SF", availableSf: 749_999, buildingCount: 2 },
      { bucket: "500k SF+", availableSf: 500_000, buildingCount: 1 },
    ]);
  });
  it("maps construction, deliveries, sales volume, and the verified nominal median series", () => {
    const result = aggregateQuarterlyMarketPeriod("2026 Q2", [
      {
        Id: "a",
        Inventory_SF__c: 100,
        Total_Vacant_SF__c: 5,
        Total_Available_SF__c: 8,
        Under_Construction_SF__c: 20,
        Delivered_SF__c: 10,
        Total_Net_Absorption_SF__c: -5,
        Total_Leasing_Activity_SF__c: 3,
        Sales_Volume_USD__c: 1_000,
        Sales_Transactions__c: 1,
        Median_Sales_Price_Per_Building_SF__c: 100,
      },
      {
        Id: "b",
        Inventory_SF__c: 300,
        Total_Vacant_SF__c: 15,
        Total_Available_SF__c: 24,
        Under_Construction_SF__c: 30,
        Delivered_SF__c: 15,
        Total_Net_Absorption_SF__c: 10,
        Total_Leasing_Activity_SF__c: 4,
        Sales_Volume_USD__c: 2_000,
        Sales_Transactions__c: 3,
        Median_Sales_Price_Per_Building_SF__c: 130,
      },
    ]);
    expect(result).toMatchObject({
      quarterlyNetAbsorptionSf: 5,
      underConstructionSf: 50,
      deliveredSf: 25,
      salesVolume: 3_000,
      medianSalesPricePsf: 130,
    });
  });
  it("uses ratio-of-sums for overall vacancy and availability", () => {
    const result = rollupPropertyData(
      [
        {
          Id: "a",
          Inventory_SF__c: 100,
          Vacant_SF_Total__c: 50,
          Available_SF_Total__c: 60,
        },
        {
          Id: "b",
          Inventory_SF__c: 900,
          Vacant_SF_Total__c: 0,
          Available_SF_Total__c: 40,
        },
      ],
      [market("A", 100, 10), market("B", 900, 20)],
    );
    expect(result.metrics.vacancyRate).toBe(0.05);
    expect(result.metrics.availabilityRate).toBe(0.1);
    expect(result.metrics.vacancyRate).not.toBe(0.25);
  });
  it("verifies speculative construction as available UC divided by total UC", () => {
    const result = verifiedSpeculativeShare(13_779_195, 4_659_404);
    expect(result).toBeCloseTo(0.338148, 5);
    expect(formatReportValue(result, { type: "percentage", decimals: 0 })).toBe(
      "34%",
    );
    expect(verifiedSpeculativeShare(0, 0)).toBe(0);
  });
  it("calculates a signed trailing-four-quarter window across a year boundary", () => {
    const result = calculateTrailing12MonthNetAbsorption(
      [
        { period: "Q1 2026", quarterlyNetAbsorptionSf: 2_000_000 },
        { period: "2025 Q4", quarterlyNetAbsorptionSf: -1_000_000 },
        { period: "2025 Q3", quarterlyNetAbsorptionSf: 3_000_000 },
        { period: "2025 Q2", quarterlyNetAbsorptionSf: -500_000 },
      ],
      "2026 Q1",
    );
    expect(result).toMatchObject({
      value: 3_500_000,
      status: "complete",
      inputPeriods: ["2026 Q1", "2025 Q4", "2025 Q3", "2025 Q2"],
    });
  });
  it("returns an explicit incomplete result instead of zero-filling a gap", () => {
    const result = calculateTrailing12MonthNetAbsorption(
      [
        { period: "2026 Q2", quarterlyNetAbsorptionSf: 10 },
        { period: "2026 Q1", quarterlyNetAbsorptionSf: 20 },
        { period: "2025 Q3", quarterlyNetAbsorptionSf: 40 },
      ],
      "2026 Q2",
    );
    expect(result).toMatchObject({
      value: null,
      status: "insufficient_history",
      missingPeriods: ["2025 Q4"],
    });
  });
});
