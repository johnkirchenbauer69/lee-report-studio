import { describe, expect, it } from "vitest";
import { classifyInventoryReconciliation } from "./inventoryReconciliation";

describe("inventory reconciliation materiality", () => {
  it("classifies an exact match without a QA finding", () => {
    expect(
      classifyInventoryReconciliation({
        authoritativeInventory: 66_346_013,
        propertyDataInventory: 66_346_013,
      }),
    ).toMatchObject({
      classification: "matched",
      varianceAbsolute: 0,
      variancePercentage: 0,
    });
  });

  it("classifies a small approved difference as known instead of blocking", () => {
    const result = classifyInventoryReconciliation({
      authoritativeInventory: 66_346_013,
      propertyDataInventory: 66_411_213,
      knownDifference: true,
      knownDifferenceReason: "Approved quarter-close reconciliation finding.",
    });
    expect(result).toMatchObject({
      classification: "known-difference",
      authoritativeValue: 66_346_013,
      comparisonValue: 66_411_213,
      varianceAbsolute: 65_200,
    });
    expect(result.variancePercentage).toBeCloseTo(65_200 / 66_346_013);
    expect(result.message).toContain(
      "Property Data inventory differs by 65,200 SF; official Market_Data remains selected.",
    );
    expect(result.message).toContain("0.0983%");
  });

  it("classifies a small unexplained absolute and percentage variance as a warning", () => {
    expect(
      classifyInventoryReconciliation({
        authoritativeInventory: 117_859_927,
        propertyDataInventory: 117_925_127,
      }),
    ).toMatchObject({
      classification: "warning",
      authoritativeValue: 117_859_927,
      comparisonValue: 117_925_127,
      varianceAbsolute: 65_200,
    });
  });

  it("blocks a materially large unexplained difference", () => {
    expect(
      classifyInventoryReconciliation({
        authoritativeInventory: 100_000_000,
        propertyDataInventory: 105_000_000,
      }),
    ).toMatchObject({
      classification: "blocking",
      authoritativeValue: 100_000_000,
      comparisonValue: 105_000_000,
      varianceAbsolute: 5_000_000,
      variancePercentage: 0.05,
    });
  });

  it("blocks a missing authoritative Market_Data value", () => {
    expect(
      classifyInventoryReconciliation({
        authoritativeInventory: undefined,
        propertyDataInventory: 66_411_213,
      }),
    ).toMatchObject({
      classification: "blocking",
      authoritativeValue: null,
      varianceAbsolute: null,
      reason: "Authoritative Market_Data inventory is missing or invalid.",
    });
  });
});
