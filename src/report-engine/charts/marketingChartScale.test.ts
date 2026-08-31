import { describe, expect, it } from "vitest";
import {
  catmullRomPath,
  chronologicalQuarterWindow,
  compactCurrency,
  compactNumber,
  niceTicks,
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
    expect(compactCurrency(1_190_000_000)).toBe("$1.2B");
    expect(wholeCurrency(131.8)).toBe("$132");
    expect(niceTicks(0, 0.108, 5).at(-1)).toBeGreaterThanOrEqual(0.108);
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
