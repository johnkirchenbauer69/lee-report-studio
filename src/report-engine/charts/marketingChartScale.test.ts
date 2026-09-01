import { describe, expect, it } from "vitest";
import {
  catmullRomPath,
  chronologicalQuarterWindow,
  compactCurrency,
  compactNumber,
  compactSquareFeet,
  niceTicks,
  paddedRateDomain,
  percentageTicksForDomain,
  salesPriceTicks,
  wholeCurrency,
} from "./marketingChartScale";
import { marketingChartTheme } from "./marketingChartTheme";

describe("marketing chart scale contract", () => {
  it("orders quarter categories chronologically and keeps the latest five", () => {
    const rows = [
      "2026 Q2",
      "2025 Q2",
      "2026 Q1",
      "2025 Q4",
      "2025 Q3",
      "2024 Q4",
    ].map((period) => ({ period }));
    expect(
      chronologicalQuarterWindow(rows, (row) => row.period).map(
        (row) => row.period,
      ),
    ).toEqual(["2025 Q2", "2025 Q3", "2025 Q4", "2026 Q1", "2026 Q2"]);
  });

  it("uses marketing number and sales-axis formatting", () => {
    expect(compactNumber(1_500_000)).toBe("1.5M");
    expect(compactNumber(-350_000)).toBe("-350K");
    expect(compactSquareFeet(718_000)).toBe("718K SF");
    expect(compactSquareFeet(5_206_811)).toBe("5.2M SF");
    expect(compactSquareFeet(20_000_000)).toBe("20M SF");
    expect(compactSquareFeet(0)).toBe("0 SF");
    expect(compactCurrency(20_000_000)).toBe("$20M");
    expect(compactCurrency(4_500_000)).toBe("$4.5M");
    expect(compactCurrency(68_000_000)).toBe("$68M");
    expect(compactCurrency(1_190_000_000)).toBe("$1.2B");
    expect(wholeCurrency(131.8)).toBe("$132");
    expect(niceTicks(0, 0.108, 5).at(-1)).toBeGreaterThanOrEqual(0.108);
  });

  it("pads the net chart rate domain by two percentage points", () => {
    const domain = paddedRateDomain([
      0.048, 0.051, 0.054, 0.057, 0.06, 0.084, 0.086, 0.089, 0.091, 0.09,
    ]);
    expect(domain.minimum).toBeCloseTo(0.028);
    expect(domain.maximum).toBeCloseTo(0.111);
    expect(percentageTicksForDomain(domain)).toEqual([
      0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11,
    ]);
    expect(paddedRateDomain([0.01, 0.04]).minimum).toBe(0);
  });

  it("anchors median sales price ticks at zero with a nice upper bound", () => {
    const ticks = salesPriceTicks([80, 100, 120, 140, 145]);
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(145);
    expect(ticks).toEqual([0, 20, 40, 60, 80, 100, 120, 140, 160]);
  });

  it("creates a smooth cubic path and retains strict theme tokens", () => {
    expect(
      catmullRomPath([
        { x: 0, y: 2 },
        { x: 1, y: 1 },
        { x: 2, y: 3 },
      ]),
    ).toContain(" C ");
    expect(marketingChartTheme.palette).toMatchObject({
      red: "#CD1442",
      merlot: "#4E131E",
      navy: "#003146",
      vacancy: "#337B9A",
      gray: "#696C6D",
    });
    expect(marketingChartTheme.gridWidth).toBe(0.3);
  });
});
