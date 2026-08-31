import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChartElement } from "../../types/report";
import { MarketingChart } from "./MarketingChart";

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
    expect(html).toContain("AVAILABLE (SF)");
    expect(html).toContain("Size Bucket");
  });

  it("keeps a negative net absorption bar below the zero baseline", () => {
    const html = renderToStaticMarkup(
      <MarketingChart
        element={element("net_absorption_vacancy_availability")}
        source={history}
      />,
    );
    expect(html).toContain("-350K");
  });

  it("uses a padded data range rather than zero for the sales price axis", () => {
    const html = renderToStaticMarkup(
      <MarketingChart
        element={element("sales_volume_cap_rates")}
        source={history}
      />,
    );
    expect(html).toContain("$110");
    expect(html).toContain("$135");
    expect(html).not.toContain(">$0<");
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
  });
});
