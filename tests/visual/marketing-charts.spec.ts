import { expect, test } from "@playwright/test";

const charts = [
  { page: 3, id: "availability-chart", name: "availability-by-size" },
  { page: 2, id: "chart-net", name: "net-absorption-vacancy-availability" },
  { page: 2, id: "chart-sales-unavailable", name: "sales-volume-median-price" },
  { page: 3, id: "construction-chart", name: "under-construction-deliveries" },
] as const;

const assertLegendCentered = async (
  target: import("@playwright/test").Locator,
) => {
  const geometry = await target
    .locator('[data-chart-legend="true"]')
    .evaluate((node) => {
      const legend = node as SVGGElement;
      const box = legend.getBBox();
      return {
        measuredCenter: box.x + box.width / 2,
        declaredCenter: Number(legend.dataset.legendCenterX),
        plotCenter: Number(legend.dataset.plotCenterX),
      };
    });
  expect(Math.abs(geometry.measuredCenter - geometry.plotCenter)).toBeLessThan(
    0.5,
  );
  expect(Math.abs(geometry.declaredCenter - geometry.plotCenter)).toBeLessThan(
    0.001,
  );
};

for (const chart of charts) {
  test(`${chart.name} marketing vector golden`, async ({ page }) => {
    const response = await page.request.get("/api/assets");
    test.skip(!response.ok(), "The managed font asset API is not running.");
    const payload = (await response.json()) as {
      assets: Array<{
        id: string;
        type: string;
        source: string;
        checksum?: string;
        fontFamily?: string;
        fontWeight?: number;
        fontStyle?: string;
      }>;
    };
    const semibold = payload.assets.find(
      (asset) =>
        asset.type === "font" &&
        asset.fontFamily === "Nunito Sans" &&
        asset.fontWeight === 600 &&
        asset.fontStyle === "normal",
    );
    test.skip(
      !semibold?.checksum,
      "Managed Nunito Sans Semibold is not installed.",
    );
    await page.goto(`/?benchmark=1&page=${chart.page}`, { waitUntil: "load" });
    await page.addStyleTag({
      content: `@font-face{font-family:"Nunito Sans";src:url("${semibold!.source}");font-weight:600;font-style:normal;font-display:block}`,
    });
    await page.evaluate(async () => {
      await document.fonts.load(
        'normal 600 12px "Nunito Sans"',
        "LEE managed font verification",
      );
      await document.fonts.ready;
    });
    const target = page.getByTestId(chart.id);
    await expect(target.locator("svg linearGradient")).toHaveCount(1);
    await expect(target.locator("svg filter")).toHaveCount(1);
    if (chart.id === "chart-net") {
      await assertLegendCentered(target);
      // Vacancy/Availability now render on the left value axis (the same
      // side as every other marketing chart), so this attribute-holding <g>
      // no longer sits on the chart's right edge.
      const axis = target.locator("svg g[data-line-axis-min]");
      await expect(axis).toHaveAttribute("data-line-axis-min", "0.031");
      await expect(axis).toHaveAttribute("data-line-axis-max", "0.115");
      await expect(
        target.locator("svg text").filter({ hasText: "SF" }),
      ).not.toHaveCount(0);
      await expect(
        target.locator('svg text[data-axis-tick="right"]'),
      ).toHaveCount(0);
      const tickBoxes = await target
        .locator('svg text[data-axis-tick="left"]')
        .evaluateAll((ticks) =>
          ticks.map((tick) => {
            const box = (tick as SVGTextElement).getBBox();
            return { left: box.x };
          }),
        );
      expect(tickBoxes.length).toBeGreaterThan(0);
      expect(Math.min(...tickBoxes.map((box) => box.left))).toBeGreaterThanOrEqual(
        0,
      );
    }
    if (chart.id === "chart-sales-unavailable") {
      await assertLegendCentered(target);
      const axis = target.locator("svg g[data-line-axis-min]");
      await expect(axis).toHaveAttribute("data-line-axis-min", "0");
      await expect(
        target.locator("svg text", { hasText: "PRICE ($/SF)" }),
      ).toHaveCount(0);
      await expect(
        target.locator('svg text[data-axis-tick="right"]'),
      ).toHaveCount(0);
      const tickBoxes = await target
        .locator('svg text[data-axis-tick="left"]')
        .evaluateAll((ticks) =>
          ticks.map((tick) => {
            const box = (tick as SVGTextElement).getBBox();
            return { left: box.x };
          }),
        );
      expect(tickBoxes.length).toBeGreaterThan(0);
      expect(Math.min(...tickBoxes.map((box) => box.left))).toBeGreaterThanOrEqual(
        0,
      );
    }
    if (chart.id === "availability-chart") {
      await expect(
        target.locator("svg text", { hasText: "AVAILABLE (SF)" }),
      ).toHaveCount(0);
      await expect(
        target.locator('svg text[data-axis-tick="left"]'),
      ).not.toHaveCount(0);
    }
    if (chart.id === "construction-chart") {
      await assertLegendCentered(target);
      await expect(
        target.locator("svg text", { hasText: "SQUARE FEET" }),
      ).toHaveCount(0);
      await expect(
        target.locator('svg text[data-axis-tick="left"]'),
      ).not.toHaveCount(0);
    }
    await expect(target).toHaveScreenshot(`${chart.name}.png`, {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.015,
      threshold: 0.2,
    });
  });
}

test("repeating submarket charts inherit plot-centered legends", async ({
  page,
}) => {
  await page.goto("/?benchmark=1&page=4", { waitUntil: "load" });
  await assertLegendCentered(page.getByTestId("detail-chart-net"));
  await assertLegendCentered(
    page.getByTestId("detail-chart-sales-unavailable"),
  );
  await expect(
    page
      .getByTestId("detail-chart-sales-unavailable")
      .locator("svg text", { hasText: "PRICE ($/SF)" }),
  ).toHaveCount(0);

  await page.goto("/?benchmark=1&page=5", { waitUntil: "load" });
  await expect(
    page
      .getByTestId("detail-availability-chart")
      .locator("svg text", { hasText: "AVAILABLE (SF)" }),
  ).toHaveCount(0);
  await assertLegendCentered(page.getByTestId("detail-construction-chart"));
  await expect(
    page
      .getByTestId("detail-construction-chart")
      .locator("svg text", { hasText: "SQUARE FEET" }),
  ).toHaveCount(0);
});

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

for (const chart of [
  { page: 3, id: "availability-chart", kind: "buildings" },
  { page: 2, id: "chart-sales-unavailable", kind: "sales" },
  { page: 5, id: "detail-availability-chart", kind: "buildings" },
  { page: 4, id: "detail-chart-sales-unavailable", kind: "sales" },
] as const) {
  test(`${chart.id} count chips stay legible and collision-free`, async ({
    page,
  }) => {
    await page.goto(`/?benchmark=1&page=${chart.page}`, { waitUntil: "load" });
    const target = page.getByTestId(chart.id);
    const geometry = await target.locator("svg").evaluate((svg, kind) => {
      const box = (node: Element) => {
        const b = (node as SVGGraphicsElement).getBBox();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      };
      const chips = [
        ...svg.querySelectorAll(`[data-count-chip="${kind}"]`),
      ].map((chip) => ({
        index: Number((chip as SVGGElement).dataset.barIndex),
        placement: (chip as SVGGElement).dataset.chipPlacement,
        box: box(chip.querySelector("rect")!),
        text: box(chip.querySelector("text")!),
      }));
      // Every non-chip, non-legend text: SF/$ value labels, axis ticks,
      // categories and titles.
      const texts = [...svg.querySelectorAll("text")]
        .filter(
          (node) =>
            !node.closest("[data-count-chip]") &&
            !node.closest("[data-count-chip-key]") &&
            node.textContent?.trim(),
        )
        .map((node) => ({ label: node.textContent, box: box(node) }));
      const lines = [...svg.querySelectorAll('[data-series] path')].map(
        (path) => {
          const p = path as SVGPathElement;
          const length = p.getTotalLength();
          return Array.from({ length: 400 }, (_, i) =>
            p.getPointAtLength((length * i) / 399),
          ).map((pt) => ({ x: pt.x, y: pt.y }));
        },
      );
      const view = (svg as SVGSVGElement).viewBox.baseVal;
      return {
        chips,
        texts,
        lines,
        view: { width: view.width, height: view.height },
      };
    }, chart.kind);
    expect(geometry.chips.length).toBeGreaterThan(0);
    for (const chip of geometry.chips) {
      // Inside the chart viewBox.
      expect(chip.box.x).toBeGreaterThanOrEqual(0);
      expect(chip.box.y).toBeGreaterThanOrEqual(0);
      expect(chip.box.x + chip.box.width).toBeLessThanOrEqual(
        geometry.view.width,
      );
      // The count text fits inside its chip.
      expect(chip.text.width).toBeLessThanOrEqual(chip.box.width + 0.01);
      expect(chip.text.height).toBeGreaterThan(4);
      for (const text of geometry.texts)
        expect(
          overlaps(chip.box, text.box),
          `chip ${chip.index} overlaps "${text.label}"`,
        ).toBe(false);
      for (const line of geometry.lines)
        for (const pt of line)
          expect(
            pt.x > chip.box.x &&
              pt.x < chip.box.x + chip.box.width &&
              pt.y > chip.box.y &&
              pt.y < chip.box.y + chip.box.height,
            `chip ${chip.index} crosses the median line at ${pt.x},${pt.y}`,
          ).toBe(false);
    }
    if (chart.kind === "buildings") {
      // The curated fixture's 20-75k bucket is a very small bar: its chip
      // must sit above the bar, while the tallest bucket keeps it inside.
      expect(
        geometry.chips.find((chip) => chip.index === 0)?.placement,
      ).toBe("above");
      expect(geometry.chips.find((chip) => chip.index === 4)?.placement).toBe(
        "inside",
      );
    }
  });
}
