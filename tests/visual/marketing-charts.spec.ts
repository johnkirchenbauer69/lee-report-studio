import { expect, test } from "@playwright/test";

const charts = [
  { page: 3, id: "availability-chart", name: "availability-by-size" },
  { page: 2, id: "chart-net", name: "net-absorption-vacancy-availability" },
  { page: 2, id: "chart-sales-unavailable", name: "sales-volume-median-price" },
  { page: 3, id: "construction-chart", name: "under-construction-deliveries" },
] as const;

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
      const axis = target.locator("svg g[data-right-axis-min]");
      await expect(axis).toHaveAttribute("data-right-axis-min", "0.031");
      await expect(axis).toHaveAttribute("data-right-axis-max", "0.115");
      await expect(
        target.locator("svg text").filter({ hasText: "SF" }),
      ).not.toHaveCount(0);
      const tickBoxes = await target
        .locator('svg text[data-axis-tick="right"]')
        .evaluateAll((ticks) =>
          ticks.map((tick) => {
            const box = (tick as SVGTextElement).getBBox();
            return { right: box.x + box.width };
          }),
        );
      expect(
        Math.max(...tickBoxes.map((box) => box.right)),
      ).toBeLessThanOrEqual(360);
    }
    if (chart.id === "chart-sales-unavailable") {
      const axis = target.locator("svg g[data-right-axis-min]");
      await expect(axis).toHaveAttribute("data-right-axis-min", "0");
      const title = await target
        .locator("svg text", { hasText: "PRICE ($/SF)" })
        .boundingBox();
      const tickBoxes = await target
        .locator('svg text[data-axis-tick="right"]')
        .evaluateAll((ticks) =>
          ticks.map((tick) => {
            const box = (tick as SVGTextElement).getBBox();
            return { right: box.x + box.width };
          }),
        );
      expect(title).not.toBeNull();
      expect(Math.max(...tickBoxes.map((box) => box.right))).toBeLessThan(350);
    }
    await expect(target).toHaveScreenshot(`${chart.name}.png`, {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.015,
      threshold: 0.2,
    });
  });
}
