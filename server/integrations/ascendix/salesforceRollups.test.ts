import { describe, expect, it } from "vitest";
import { formatReportValue } from "../../../src/report-engine/formatting/formatValue.ts";
import {
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
  netAbsorptionSf: 0,
  vacancyRate: 0,
  availabilityRate: 0,
  salesVolume: 0,
});
describe("live-verified Salesforce rollups", () => {
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
});
