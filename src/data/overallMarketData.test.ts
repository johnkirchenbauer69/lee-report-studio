import { describe, expect, it } from "vitest";
import {
  overallMarketData,
  periods,
  sourceNotes,
  submarketTableRows,
  submarkets,
} from "./overallMarketData";
import { sampleTemplate } from "./sampleTemplate";
import { validatePage } from "../engine/validation";

describe("normalized overall-market data", () => {
  it("reconciles additive submarket totals to the approved report", () => {
    expect(submarkets.reduce((sum, item) => sum + item.inventorySf, 0)).toBe(
      1_257_981_203,
    );
    expect(submarkets.reduce((sum, item) => sum + item.deliveredSf, 0)).toBe(
      1_651_772,
    );
    expect(
      submarkets.reduce((sum, item) => sum + item.underConstructionSf, 0),
    ).toBe(13_912_547);
    expect(
      submarkets.reduce((sum, item) => sum + item.quarterlyNetAbsorptionSf, 0),
    ).toBe(5_206_811);
  });

  it("uses inventory-weighted vacancy and availability totals", () => {
    const inventory = submarkets.reduce(
      (sum, item) => sum + item.inventorySf,
      0,
    );
    const vacancy =
      submarkets.reduce(
        (sum, item) => sum + item.vacancyRate * item.inventorySf,
        0,
      ) / inventory;
    const availability =
      submarkets.reduce(
        (sum, item) => sum + item.availabilityRate * item.inventorySf,
        0,
      ) / inventory;
    expect(vacancy).toBeCloseTo(
      overallMarketData.overallMarket.vacancyRate,
      10,
    );
    expect(availability).toBeCloseTo(
      overallMarketData.overallMarket.availabilityRate,
      10,
    );
  });

  it("keeps quarterly and trailing-12-month absorption distinct", () => {
    expect(overallMarketData.overallMarket.quarterlyNetAbsorptionSf).toBe(
      5_206_811,
    );
    expect(periods[0].trailing12MonthNetAbsorptionSf).toBe(17_654_829);
    expect(
      periods
        .slice(0, 5)
        .map((period) => period.trailing12MonthNetAbsorptionSf),
    ).toEqual([17_654_829, 17_675_415, 18_086_895, 12_657_528, 4_547_144]);
    periods.slice(0, 5).forEach((period, index) => {
      const quarterlyWindow = periods
        .slice(index, index + 4)
        .reduce((sum, input) => sum + input.quarterlyNetAbsorptionSf, 0);
      expect(period.trailing12MonthNetAbsorptionSf).toBe(quarterlyWindow);
    });
  });

  it("preserves approved-versus-alternate source discrepancies", () => {
    expect(sourceNotes).toContainEqual(
      expect.objectContaining({
        fieldPath: "overallMarket.vacancyRate",
        status: "reconciled",
      }),
    );
    expect(
      sourceNotes.find((note) => note.fieldPath === "overallMarket.vacancyRate")
        ?.sources,
    ).toContainEqual(expect.objectContaining({ value: 0.0484 }));
    expect(sourceNotes).toContainEqual(
      expect.objectContaining({
        fieldPath: "overallMarket.availabilityRate",
        status: "reconciled",
      }),
    );
  });

  it("builds detail, total, minimum and maximum presentation rows", () => {
    expect(submarketTableRows).toHaveLength(21);
    expect(submarketTableRows.slice(-3).map((row) => row.kind)).toEqual([
      "total",
      "minimum",
      "maximum",
    ]);
  });

  it("keeps every production page inside its letter-size canvas", () => {
    const errors = sampleTemplate.pages
      .flatMap((page) => validatePage(page, overallMarketData))
      .filter((issue) => issue.level === "error");
    expect(errors).toEqual([]);
  });
});
