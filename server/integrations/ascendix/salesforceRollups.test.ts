import { describe, expect, it } from "vitest";
import { formatReportValue } from "../../../src/report-engine/formatting/formatValue.ts";
import {
  aggregateAvailabilityBySize,
  aggregateQuarterlyMarketPeriod,
  calculateTrailing12MonthNetAbsorption,
  mapOverallMarketPeriod,
  rollupPropertyData,
  verifiedMedianSalesPricePsf,
  verifiedSpeculativeShare,
} from "./salesforceRollups.ts";
import { normalizeSalesforceMarketDataRecord } from "./salesforceNormalization.ts";

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
  it("does not substitute a weighted median of submarket medians for an overall transaction median", () => {
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
      medianSalesPricePsf: null,
    });
    expect(
      verifiedMedianSalesPricePsf([
        {
          Id: "a",
          Median_Sales_Price_Per_Building_SF__c: 100,
          Sales_Transactions__c: 1,
        },
        {
          Id: "b",
          Median_Sales_Price_Per_Building_SF__c: 130,
          Sales_Transactions__c: 3,
        },
      ]),
    ).toBeNull();
  });
  it("retains a direct verified Market_Data median for one submarket", () => {
    expect(
      aggregateQuarterlyMarketPeriod("2026 Q2", [
        {
          Id: "a",
          Median_Sales_Price_Per_Building_SF__c: 146.52,
        },
      ]).medianSalesPricePsf,
    ).toBe(146.52);
  });
  it("distinguishes explicit historical zero from missing delivered and sales values", () => {
    const zero = aggregateQuarterlyMarketPeriod("2026 Q2", [
      { Id: "a", Delivered_SF__c: 0, Sales_Volume_USD__c: 0 },
    ]);
    const missing = aggregateQuarterlyMarketPeriod("2026 Q2", [{ Id: "b" }]);
    expect(zero.deliveredSf).toBe(0);
    expect(zero.salesVolume).toBe(0);
    expect(missing.deliveredSf).toBeUndefined();
    expect(missing.salesVolume).toBeUndefined();
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

  describe("Availability By Size Range distinct-building counts", () => {
    it("counts each Property once, even with duplicate Property_Data rows", () => {
      const buckets = aggregateAvailabilityBySize([
        { Id: "pd-1", Property__c: "prop-A", Available_SF_Total__c: 30_000 },
        { Id: "pd-2", Property__c: "prop-A", Available_SF_Total__c: 30_000 },
        { Id: "pd-3", Property__c: "prop-B", Available_SF_Total__c: 50_000 },
        { Id: "pd-4", Property__c: "prop-C", Available_SF_Total__c: 600_000 },
      ]);
      expect(buckets[0]).toEqual({
        bucket: "20-75k SF",
        availableSf: 110_000,
        buildingCount: 2,
      });
      expect(buckets[4]).toMatchObject({ availableSf: 600_000, buildingCount: 1 });
    });

    it("keeps unlinked rows distinct by their own Property_Data Id", () => {
      const [bucket] = aggregateAvailabilityBySize([
        { Id: "pd-1", Available_SF_Total__c: 40_000 },
        { Id: "pd-2", Available_SF_Total__c: 41_000 },
      ]);
      expect(bucket!.buildingCount).toBe(2);
    });

    it("reports zero buildings for every zero-SF bucket and keeps the five buckets unchanged", () => {
      const buckets = aggregateAvailabilityBySize([
        { Id: "pd-1", Property__c: "prop-A", Available_SF_Total__c: 0 },
        { Id: "pd-2", Property__c: "prop-B", Available_SF_Total__c: 160_000 },
      ]);
      expect(buckets.map((bucket) => bucket.bucket)).toEqual([
        "20-75k SF",
        "75-150k SF",
        "150-250k SF",
        "250-500k SF",
        "500k SF+",
      ]);
      expect(buckets.map((bucket) => bucket.buildingCount)).toEqual([
        0, 0, 1, 0, 0,
      ]);
      expect(
        buckets.every(
          (bucket) => bucket.availableSf > 0 || bucket.buildingCount === 0,
        ),
      ).toBe(true);
    });
  });

  describe("governed Sales transaction counts", () => {
    const period = (overrides: Record<string, unknown>[]) =>
      aggregateQuarterlyMarketPeriod(
        "2026 Q3",
        overrides.map((extra, index) => ({
          Id: `md-${index}`,
          Inventory_SF__c: 100,
          Sales_Volume_USD__c: 1_000,
          ...extra,
        })),
      );

    it("sums Sales_Transactions__c over the same rows that produce Sales Volume", () => {
      expect(
        period([{ Sales_Transactions__c: 10 }, { Sales_Transactions__c: 4 }]),
      ).toMatchObject({ salesVolume: 2_000, salesTransactions: 14 });
    });

    it("is unavailable (not zero, not inferred) when any row lacks the governed count", () => {
      const result = period([
        { Sales_Transactions__c: 10 },
        { Sales_Transactions__c: null },
      ]);
      expect(result.salesTransactions).toBeUndefined();
      expect(result.salesVolume).toBe(2_000);
    });

    it("keeps a governed zero count as zero", () => {
      expect(
        period([{ Sales_Volume_USD__c: 0, Sales_Transactions__c: 0 }])
          .salesTransactions,
      ).toBe(0);
    });
  });

  describe("first-class Overall Market period mapping", () => {
    const row = (extra: Record<string, unknown> = {}) =>
      normalizeSalesforceMarketDataRecord({
        Id: "a1wVy000008qTKfIAM",
        External_Id__c: "OVERALL_MARKET::2026-09-30",
        Quarter_Label__c: "2026 Q3",
        Total_Net_Absorption_SF__c: 6_807_627,
        Total_Vacant_Percent__c: 5.090682,
        Total_Available_Percent__c: 8.291963,
        Under_Construction_SF__c: 17_530_947,
        Delivered_SF__c: 2_077_507,
        Sales_Volume_USD__c: 1_181_229_487.5,
        Sales_Transactions__c: 131,
        Median_Sales_Price_Per_Building_SF__c: 106,
        Total_Leasing_Activity_SF__c: 16_559_754,
        ...extra,
      });

    it("maps one row to one quarter with no aggregation and passes the median through", () => {
      expect(mapOverallMarketPeriod("2026 Q3", row())).toEqual({
        period: "2026 Q3",
        quarterlyNetAbsorptionSf: 6_807_627,
        vacancyRate: expect.closeTo(0.05090682, 12),
        availabilityRate: expect.closeTo(0.08291963, 12),
        underConstructionSf: 17_530_947,
        deliveredSf: 2_077_507,
        salesVolume: 1_181_229_487.5,
        salesTransactions: 131,
        medianSalesPricePsf: 106,
        leasingActivitySf: 16_559_754,
        source: {
          authority: "OVERALL_MARKET_RECORD",
          quarter: "2026 Q3",
          externalIds: ["OVERALL_MARKET::2026-09-30"],
          authoritativeNulls: [],
        },
        sourceIds: ["a1wVy000008qTKfIAM"],
      });
    });

    it("preserves every null as an authoritative null (never zero)", () => {
      const period = mapOverallMarketPeriod(
        "2025 Q2",
        row({
          Quarter_Label__c: "2025 Q2",
          Total_Vacant_Percent__c: null,
          Total_Net_Absorption_SF__c: null,
          Median_Sales_Price_Per_Building_SF__c: null,
        }),
      );
      expect(period.vacancyRate).toBeNull();
      expect(period.quarterlyNetAbsorptionSf).toBeNull();
      expect(period.medianSalesPricePsf).toBeNull();
      expect(period.source?.authoritativeNulls).toEqual([
        "quarterlyNetAbsorptionSf",
        "vacancyRate",
        "medianSalesPricePsf",
      ]);
    });

    it("makes trailing 12-month unavailable when a required quarter has an authoritative null", () => {
      const periods = [
        { period: "2025 Q3", quarterlyNetAbsorptionSf: 5_045_142 },
        { period: "2025 Q2", quarterlyNetAbsorptionSf: 5_227_397 },
        { period: "2025 Q1", quarterlyNetAbsorptionSf: 5_450_231 },
        { period: "2024 Q4", quarterlyNetAbsorptionSf: null },
      ];
      expect(calculateTrailing12MonthNetAbsorption(periods, "2025 Q3")).toMatchObject({
        value: null,
        status: "authoritative_null",
        nullPeriods: ["2024 Q4"],
        missingPeriods: [],
      });
    });
  });
});
