import { describe, expect, it } from "vitest";
import {
  availabilitySizeBucket,
  normalizeQuarterBounds,
  normalizeSalesforceMarketDataRecord,
  normalizeSalesforcePercent,
} from "./salesforceNormalization.ts";

describe("verified Salesforce normalization", () => {
  it("normalizes dashboard percent scales idempotently", () => {
    expect(normalizeSalesforcePercent("Total_Vacant_Percent__c", 4.96)).toBe(
      0.0496,
    );
    expect(normalizeSalesforcePercent("Total_Vacant_Percent__c", 0.0496)).toBe(
      0.0496,
    );
    expect(
      normalizeSalesforcePercent("Total_Vacant_Available_Percent__c", 85.3),
    ).toBe(0.0853);
    const once = normalizeSalesforceMarketDataRecord({
      Id: "1",
      Total_Available_Percent__c: 8.53,
    });
    expect(
      normalizeSalesforceMarketDataRecord(once).Total_Available_Percent__c,
    ).toBeCloseTo(0.0853);
  });
  it("normalizes compact and spaced quarter labels", () => {
    expect(normalizeQuarterBounds("2026Q2")).toEqual({
      label: "2026 Q2",
      start: "2026-04-01",
      end: "2026-06-30",
      year: 2026,
      quarter: 2,
    });
    expect(normalizeQuarterBounds("2026 Q2").label).toBe("2026 Q2");
  });
  it("uses explicit 20k+ availability buckets", () => {
    expect(availabilitySizeBucket(19_999)).toBeUndefined();
    expect(availabilitySizeBucket(20_000)).toBe("20-75k SF");
    expect(availabilitySizeBucket(500_000)).toBe("500k SF+");
  });
});
