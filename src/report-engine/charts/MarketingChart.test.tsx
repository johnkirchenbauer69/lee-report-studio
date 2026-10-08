import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChartElement } from "../../types/report";
import {
  displayableCount,
  MarketingChart,
  marketingPlotCenterX,
  placeCountChip,
} from "./MarketingChart";
import { MARKETING_CHART_BASE, marketingChartTheme } from "./marketingChartTheme";

const element = (
  marketingChartId: ChartElement["marketingChartId"],
): ChartElement => ({
  id: `fixture-${marketingChartId}`,
  type: "chart",
  name: String(marketingChartId),
  marketingChartId,
  x: 0,
  y: 0,
  width: 360,
  height: 216,
  sourcePath: "rows",
  categoryPath:
    marketingChartId === "availability_by_size" ? "bucket" : "period",
  valuePath: "availableSf",
  chartType: "combination",
  style: {},
  chartStyle: {
    fontFamily: "Nunito Sans",
    fontWeight: 600,
    fontAssetId: "nunito-600",
    fontChecksum: "fixture",
  },
});

const history = [
  {
    period: "2025 Q2",
    quarterlyNetAbsorptionSf: 900_000,
    vacancyRate: 0.058,
    availabilityRate: 0.092,
    underConstructionSf: 5_500_000,
    deliveredSf: 2_100_000,
    salesVolume: 680_000_000,
    medianSalesPricePsf: 112,
  },
  {
    period: "2025 Q3",
    quarterlyNetAbsorptionSf: -350_000,
    vacancyRate: 0.061,
    availabilityRate: 0.095,
    underConstructionSf: 6_000_000,
    deliveredSf: 2_700_000,
    salesVolume: 850_000_000,
    medianSalesPricePsf: 118,
  },
  {
    period: "2025 Q4",
    quarterlyNetAbsorptionSf: 1_250_000,
    vacancyRate: 0.057,
    availabilityRate: 0.091,
    underConstructionSf: 7_200_000,
    deliveredSf: 3_300_000,
    salesVolume: 530_000_000,
    medianSalesPricePsf: 121,
  },
  {
    period: "2026 Q1",
    quarterlyNetAbsorptionSf: 650_000,
    vacancyRate: 0.054,
    availabilityRate: 0.088,
    underConstructionSf: 8_600_000,
    deliveredSf: 2_900_000,
    salesVolume: 955_000_000,
    medianSalesPricePsf: 126,
  },
  {
    period: "2026 Q2",
    quarterlyNetAbsorptionSf: 1_700_000,
    vacancyRate: 0.051,
    availabilityRate: 0.084,
    underConstructionSf: 9_300_000,
    deliveredSf: 4_100_000,
    salesVolume: 1_190_000_000,
    medianSalesPricePsf: 132,
  },
];

describe("MarketingChart vector output", () => {
  it.each([
    "net_absorption_vacancy_availability",
    "sales_volume_cap_rates",
    "construction_uc_deliveries",
  ] as const)(
    "renders %s with a gradient, shadow, managed face, and no animation",
    (id) => {
      const html = renderToStaticMarkup(
        <MarketingChart element={element(id)} source={history} />,
      );
      expect(html).toContain("linearGradient");
      expect(html).toContain("feDropShadow");
      expect(html).toContain("LEE Managed nunito-600");
      expect(html).not.toContain("animate");
      expect(html).toContain("2025 Q2");
      expect(html).toContain("2026 Q2");
    },
  );

  it("renders exact availability bucket order and labels", () => {
    const rows = [
      "20-75k SF",
      "75-150k SF",
      "150-250k SF",
      "250-500k SF",
      "500k SF+",
    ].map((bucket, index) => ({
      bucket,
      availableSf: (index + 1) * 100_000,
      buildingCount: index + 1,
    }));
    const html = renderToStaticMarkup(
      <MarketingChart
        element={element("availability_by_size")}
        source={rows}
      />,
    );
    const positions = rows.map((row) => html.indexOf(row.bucket));
    expect(
      positions.every(
        (position, index) => index === 0 || position > positions[index - 1]!,
      ),
    ).toBe(true);
    expect(html).not.toContain("AVAILABLE (SF)");
    expect(html).toContain("Size Bucket");
    expect(html).toContain('data-axis-tick="left"');
  });

  it("keeps a negative net absorption bar below the zero baseline", () => {
    const html = renderToStaticMarkup(
      <MarketingChart
        element={element("net_absorption_vacancy_availability")}
        source={history}
      />,
    );
    expect(html).toContain("-350K SF");
    // The Vacancy/Availability value axis renders on the left, so its tick
    // labels sit just left of the plot area (anchor "end").
    const combinationMargin = marketingChartTheme.margins.combination;
    expect(html).toContain(`x="${combinationMargin.left - 5}"`);
    expect(html).toContain('data-axis-tick="left"');
    expect(html).toContain('text-anchor="end"');
  });

  it("keeps the sales price axis and ticks on the left while omitting its title", () => {
    const html = renderToStaticMarkup(
      <MarketingChart
        element={element("sales_volume_cap_rates")}
        source={history}
      />,
    );
    expect(html).toContain(">$0<");
    expect(html).toContain(">$140<");
    expect(html).toContain('data-line-axis-min="0"');
    expect(html).toContain('data-axis-tick="left"');
    expect(html).not.toContain('data-axis-tick="right"');
    expect(html).not.toContain("PRICE ($/SF)");
    // Net Absorption and Sales Volume now share identical plot-area
    // proportions so the two charts line up visually on the page.
    expect(marketingChartTheme.margins.sales).toEqual(
      marketingChartTheme.margins.combination,
    );
  });

  it("renders explicit compact SF zero labels", () => {
    const zeroHistory = history.map((row) => ({
      ...row,
      quarterlyNetAbsorptionSf: 0,
      deliveredSf: 0,
    }));
    const net = renderToStaticMarkup(
      <MarketingChart
        element={element("net_absorption_vacancy_availability")}
        source={zeroHistory}
      />,
    );
    const construction = renderToStaticMarkup(
      <MarketingChart
        element={element("construction_uc_deliveries")}
        source={zeroHistory}
      />,
    );
    expect(net).toContain("0 SF");
    expect(construction).toContain("0 SF");
  });

  it("renders missing bars as unavailable without creating zero-height data bars", () => {
    const sales = renderToStaticMarkup(
      <MarketingChart
        element={element("sales_volume_cap_rates")}
        source={history.map((row, index) =>
          index === 1 ? { ...row, salesVolume: undefined } : row,
        )}
      />,
    );
    const construction = renderToStaticMarkup(
      <MarketingChart
        element={element("construction_uc_deliveries")}
        source={history.map((row, index) =>
          index === 1 ? { ...row, deliveredSf: undefined } : row,
        )}
      />,
    );
    expect(sales).toContain("Unavailable");
    expect(construction).toContain("Unavailable");
    expect(sales).not.toContain('data-bar-index="1"');
    const availability = renderToStaticMarkup(
      <MarketingChart
        element={element("availability_by_size")}
        source={[{ bucket: "20-75k SF", buildingCount: 1 }]}
      />,
    );
    expect(availability).toContain("Unavailable");
  });

  it("breaks line paths at missing historical values", () => {
    const html = renderToStaticMarkup(
      <MarketingChart
        element={element("net_absorption_vacancy_availability")}
        source={history.map((row, index) =>
          index === 2 ? { ...row, vacancyRate: undefined } : row,
        )}
      />,
    );
    expect(html).toContain("2025 Q4: Unavailable");
    const vacancyGroup =
      html.match(/<g data-series="vacancyRate">([\s\S]*?)<\/g>/)?.[1] ?? "";
    expect(vacancyGroup.match(/<path/g) ?? []).toHaveLength(2);
  });

  it("keeps sales volume while explicitly marking an unavailable aggregate median", () => {
    const html = renderToStaticMarkup(
      <MarketingChart
        element={element("sales_volume_cap_rates")}
        source={history.map((row) => ({
          ...row,
          medianSalesPricePsf: null,
        }))}
      />,
    );
    expect(html).toContain("$1.2B");
    expect(html).toContain("Median Sales Price unavailable");
    expect(html).not.toContain('data-axis-tick="right"');
  });

  it("uses clustered construction legend naming and order", () => {
    const html = renderToStaticMarkup(
      <MarketingChart
        element={element("construction_uc_deliveries")}
        source={history}
      />,
    );
    expect(html.indexOf("Under Construction")).toBeLessThan(
      html.indexOf("Deliveries"),
    );
    expect(html).toContain('data-axis-tick="left"');
    expect(html).not.toContain("SQUARE FEET");
  });

  it.each([
    [
      "net_absorption_vacancy_availability",
      marketingChartTheme.margins.combination,
    ],
    ["sales_volume_cap_rates", marketingChartTheme.margins.sales],
    ["construction_uc_deliveries", marketingChartTheme.margins.construction],
  ] as const)("centers the %s legend on its plot area", (id, margin) => {
    const html = renderToStaticMarkup(
      <MarketingChart element={element(id)} source={history} />,
    );
    const center = marketingPlotCenterX(margin);

    expect(html).toContain(`data-chart-legend="true"`);
    expect(html).toContain(`data-legend-center-x="${center}"`);
    expect(html).toContain(`data-plot-center-x="${center}"`);
  });

  describe("paired Market Overview chart geometry (Net Absorption vs Sales Volume)", () => {
    const netHtml = () =>
      renderToStaticMarkup(
        <MarketingChart
          element={element("net_absorption_vacancy_availability")}
          source={history}
        />,
      );
    const salesHtml = () =>
      renderToStaticMarkup(
        <MarketingChart
          element={element("sales_volume_cap_rates")}
          source={history}
        />,
      );
    const barWidthOf = (html: string, index: number) => {
      const re = new RegExp(`data-bar-index="${index}"[^>]*width="([\\d.]+)"`);
      const match = html.match(re);
      return match ? Number(match[1]) : undefined;
    };
    const barXOf = (html: string, index: number) => {
      const re = new RegExp(`data-bar-index="${index}"[^>]*x="(-?[\\d.]+)"`);
      const match = html.match(re);
      return match ? Number(match[1]) : undefined;
    };
    const rightAxisXPositions = (html: string) =>
      [...html.matchAll(/data-axis-tick="left"[^>]*x="(-?[\d.]+)"/g)].map(
        (m) => Number(m[1]),
      );

    it("gives both charts an identical plot rectangle (margins.sales === margins.combination)", () => {
      expect(marketingChartTheme.margins.sales).toEqual(
        marketingChartTheme.margins.combination,
      );
    });

    it("1. plot-area width is equal", () => {
      const { left: netLeft, right: netRight } = marketingChartTheme.margins.combination;
      const { left: salesLeft, right: salesRight } = marketingChartTheme.margins.sales;
      const netPlotWidth = MARKETING_CHART_BASE.width - netLeft - netRight;
      const salesPlotWidth = MARKETING_CHART_BASE.width - salesLeft - salesRight;
      expect(salesPlotWidth).toBeCloseTo(netPlotWidth, 5);
    });

    it("2. first category (bar) center has the same relative x-position in both charts", () => {
      const net = netHtml();
      const sales = salesHtml();
      const netX = barXOf(net, 0)!;
      const salesX = barXOf(sales, 0)!;
      const netWidth = barWidthOf(net, 0)!;
      const salesWidth = barWidthOf(sales, 0)!;
      expect(netX + netWidth / 2).toBeCloseTo(salesX + salesWidth / 2, 1);
    });

    it("3. last category (bar) center has the same relative x-position in both charts", () => {
      const net = netHtml();
      const sales = salesHtml();
      const lastIndex = history.length - 1;
      const netX = barXOf(net, lastIndex)!;
      const salesX = barXOf(sales, lastIndex)!;
      const netWidth = barWidthOf(net, lastIndex)!;
      const salesWidth = barWidthOf(sales, lastIndex)!;
      expect(netX + netWidth / 2).toBeCloseTo(salesX + salesWidth / 2, 1);
    });

    it("4. bar width remains equal", () => {
      const net = netHtml();
      const sales = salesHtml();
      expect(barWidthOf(sales, 0)).toBeCloseTo(barWidthOf(net, 0)!, 5);
    });

    it("5. category spacing (bandwidth between consecutive bar centers) remains equal", () => {
      const net = netHtml();
      const sales = salesHtml();
      const netSpacing = barXOf(net, 1)! - barXOf(net, 0)!;
      const salesSpacing = barXOf(sales, 1)! - barXOf(sales, 0)!;
      expect(salesSpacing).toBeCloseTo(netSpacing, 5);
    });

    it("6. value-axis labels stay within the chart's SVG bounds (no clipping) on both charts", () => {
      const net = netHtml();
      const sales = salesHtml();
      for (const positions of [rightAxisXPositions(net), rightAxisXPositions(sales)]) {
        expect(positions.length).toBeGreaterThan(0);
        for (const x of positions) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(MARKETING_CHART_BASE.width);
        }
      }
    });
  });

  it("does not add a legend to Availability by Size", () => {
    const html = renderToStaticMarkup(
      <MarketingChart
        element={element("availability_by_size")}
        source={[
          { bucket: "20-75k SF", availableSf: 100_000, buildingCount: 2 },
        ]}
      />,
    );
    expect(html).not.toContain("data-chart-legend");
  });
});

describe("count chips", () => {
  const chipAttrs = (markup: string, kind: "buildings" | "sales") =>
    [
      ...markup.matchAll(
        new RegExp(
          `<g data-count-chip="${kind}" data-bar-index="(\\d+)" data-count="(\\d+)" data-chip-placement="([a-z-]+)" data-chip-top="([\\d.-]+)" data-chip-bottom="([\\d.-]+)"`,
          "g",
        ),
      ),
    ].map((match) => ({
      index: Number(match[1]),
      count: Number(match[2]),
      placement: match[3],
      top: Number(match[4]),
      bottom: Number(match[5]),
    }));
  const barRects = (markup: string) =>
    [
      ...markup.matchAll(
        /<rect (?:data-bar-index="\d+" )?x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)" fill="url\(#[^)]*-red-gradient\)"/g,
      ),
    ].map((match) => ({
      x: Number(match[1]),
      y: Number(match[2]),
      width: Number(match[3]),
      height: Number(match[4]),
    }));

  describe("Availability By Size Range", () => {
    const buckets = [
      { bucket: "20-75k SF", availableSf: 1_250_000, buildingCount: 31 },
      { bucket: "75-150k SF", availableSf: 0, buildingCount: 7 },
      { bucket: "150-250k SF", availableSf: 40_000, buildingCount: 1 },
      { bucket: "250-500k SF", availableSf: 900_000, buildingCount: 3 },
      { bucket: "500k SF+", availableSf: 600_000, buildingCount: 1 },
    ];
    const withoutCounts = buckets.map(
      ({ buildingCount: _count, ...rest }) => rest,
    );
    const render = (rows: unknown[]) =>
      renderToStaticMarkup(
        <MarketingChart
          element={element("availability_by_size")}
          source={rows}
        />,
      );

    it("labels each non-zero bucket with its distinct-building count in a navy chip", () => {
      const markup = render(buckets);
      const chips = chipAttrs(markup, "buildings");
      expect(chips.map((chip) => [chip.index, chip.count])).toEqual([
        [0, 31],
        [2, 1],
        [3, 3],
        [4, 1],
      ]);
      expect(markup).toContain(`fill="${marketingChartTheme.countChip.fill}"`);
      expect(markup).toContain('data-count-chip-key="Buildings"');
    });

    it("suppresses the chip for a zero-SF bucket even when the source reports a count", () => {
      const chips = chipAttrs(render(buckets), "buildings");
      expect(chips.find((chip) => chip.index === 1)).toBeUndefined();
    });

    it("puts the chip inside tall bars and above the SF label for very small bars", () => {
      const markup = render(buckets);
      const chips = chipAttrs(markup, "buildings");
      const rects = barRects(markup);
      const tall = chips.find((chip) => chip.index === 0)!;
      expect(tall.placement).toBe("inside");
      expect(tall.top).toBeGreaterThan(rects[0]!.y);
      expect(tall.bottom).toBeLessThan(rects[0]!.y + rects[0]!.height);
      const small = chips.find((chip) => chip.index === 2)!;
      expect(small.placement).toBe("above");
      // Above the bar AND above the SF value label drawn 4 units over it.
      const labelTop =
        rects[2]!.y - 4 - marketingChartTheme.typography.barLabel * 0.8;
      expect(small.bottom).toBeLessThanOrEqual(labelTop);
      expect(small.top).toBeGreaterThanOrEqual(0);
    });

    it("does not change bar geometry, and renders no chips without counts", () => {
      expect(barRects(render(buckets))).toEqual(
        barRects(render(withoutCounts)),
      );
      const markup = render(withoutCounts);
      expect(chipAttrs(markup, "buildings")).toEqual([]);
      expect(markup).not.toContain("data-count-chip-key");
    });
  });

  describe("Sales Volume & Median Sales Price", () => {
    const periods = [
      {
        period: "2025 Q3",
        salesVolume: 846_763_481,
        salesTransactions: 134,
        medianSalesPricePsf: 105,
      },
      {
        period: "2025 Q4",
        salesVolume: 1_216_533_978,
        salesTransactions: 185,
        medianSalesPricePsf: 112,
      },
      {
        period: "2026 Q1",
        salesVolume: 1_065_889_944,
        salesTransactions: 158,
        medianSalesPricePsf: 109,
      },
      {
        period: "2026 Q2",
        salesVolume: 0,
        salesTransactions: 3,
        medianSalesPricePsf: 120,
      },
      {
        period: "2026 Q3",
        salesVolume: 12_425_493,
        salesTransactions: 4,
        medianSalesPricePsf: 99,
      },
    ];
    const render = (rows: unknown[]) =>
      renderToStaticMarkup(
        <MarketingChart
          element={element("sales_volume_cap_rates")}
          source={rows}
        />,
      );

    it("labels each bar with the governed qualifying-sale count", () => {
      const markup = render(periods);
      expect(
        chipAttrs(markup, "sales").map((chip) => [chip.index, chip.count]),
      ).toEqual([
        [0, 134],
        [1, 185],
        [2, 158],
        [4, 4],
      ]);
      expect(markup).toContain('data-count-chip-key="Sales"');
    });

    it("shows no chip for a zero-volume period even if a count is present", () => {
      expect(
        chipAttrs(render(periods), "sales").find((chip) => chip.index === 3),
      ).toBeUndefined();
    });

    it("gracefully omits every chip (and the key) when the count is not in the data contract", () => {
      const markup = render(
        periods.map(({ salesTransactions: _count, ...rest }) => rest),
      );
      expect(chipAttrs(markup, "sales")).toEqual([]);
      expect(markup).not.toContain("data-count-chip-key");
      expect(barRects(markup)).toEqual(barRects(render(periods)));
    });

    it("never overlaps the Median Sales Price line at the bar centre", () => {
      const markup = render(periods);
      const axisMin = Number(
        markup.match(/data-line-axis-min="([\d.]+)"/)![1],
      );
      const axisMax = Number(
        markup.match(/data-line-axis-max="([\d.]+)"/)![1],
      );
      const { top, bottom } = marketingChartTheme.margins.sales;
      const plotHeight = MARKETING_CHART_BASE.height - top - bottom;
      const chips = chipAttrs(markup, "sales");
      expect(chips.length).toBe(4);
      for (const chip of chips) {
        const median = periods[chip.index]!.medianSalesPricePsf;
        const lineY =
          top + ((axisMax - median) / (axisMax - axisMin)) * plotHeight;
        const clear = lineY < chip.top - 0.5 || lineY > chip.bottom + 0.5;
        expect(clear, `chip ${chip.index} vs line at ${lineY}`).toBe(true);
        expect(chip.top).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("placeCountChip", () => {
    const { height, inset } = marketingChartTheme.countChip;
    it("prefers the upper inside of a bar that is tall enough", () => {
      expect(
        placeCountChip({ barTop: 50, barBottom: 180, labelTop: 42 }),
      ).toEqual({ top: 50 + inset, placement: "inside" });
    });
    it("moves to the bar base when the line crosses the upper inside", () => {
      expect(
        placeCountChip({
          barTop: 50,
          barBottom: 180,
          labelTop: 42,
          avoid: [[50, 60]],
        }),
      ).toEqual({ top: 180 - inset - height, placement: "inside-base" });
    });
    it("goes above the value label when the bar is too short", () => {
      const placed = placeCountChip({
        barTop: 175,
        barBottom: 180,
        labelTop: 166,
      });
      expect(placed.placement).toBe("above");
      expect(placed.top + height).toBeLessThan(166);
    });
    it("hops above a line that crosses the external slot", () => {
      const placed = placeCountChip({
        barTop: 175,
        barBottom: 180,
        labelTop: 166,
        avoid: [[150, 158]],
      });
      expect(placed.top + height).toBeLessThan(150);
    });
    it("suppresses chips for zero/absent bars and non-positive counts", () => {
      expect(displayableCount(0, 5)).toBeUndefined();
      expect(displayableCount(undefined, 5)).toBeUndefined();
      expect(displayableCount(100, 0)).toBeUndefined();
      expect(displayableCount(100, undefined)).toBeUndefined();
      expect(displayableCount(100, 2.5)).toBeUndefined();
      expect(displayableCount(100, 12)).toBe(12);
    });
  });
});
