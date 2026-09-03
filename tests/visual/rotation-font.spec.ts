import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

test("rotation and font transform fixture", async ({ page }) => {
  await page.goto("/?rotationBenchmark=1", { waitUntil: "load" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  for (const [id, expected] of [
    ["rotation-title", 17],
    ["rotation-shape", 33],
    ["rotation-image", 315],
    ["rotation-table", 6],
    ["rotation-chart", 350],
    ["rotation-ninety", 90],
  ] as const) {
    const actual = await page
      .locator(`[data-testid="${id}"]`)
      .evaluate((node) => {
        const matrix = new DOMMatrix(getComputedStyle(node).transform);
        return ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360;
      });
    expect(actual).toBeCloseTo(expected, 1);
  }
  await expect(page.getByTestId("rotation-title")).toHaveCSS(
    "text-shadow",
    "rgba(0, 0, 0, 0.35) 3px 4px 5px",
  );
  await expect(page.getByTestId("rotation-shape")).toHaveCSS(
    "box-shadow",
    "rgba(0, 60, 80, 0.4) 6px 7px 9px 0px",
  );
  const image = page.getByTestId("rotation-image");
  await expect(image).toHaveCSS("border-radius", "22px");
  await expect(image).toHaveCSS("border-width", "5px");
  await expect(image).toHaveCSS("border-color", "rgb(196, 18, 63)");
  const clip = image.locator('[data-image-clip="true"]');
  await expect(clip).toHaveCSS("overflow", "hidden");
  await expect(clip).toHaveCSS("border-radius", "22px");
  const radiusOnly = page.getByTestId("effects-radius-only");
  await expect(radiusOnly).toHaveCSS("border-radius", "20px");
  await expect(radiusOnly).toHaveCSS("border-width", "0px");
  await expect(radiusOnly.locator('[data-image-clip="true"]')).toHaveCSS(
    "border-radius",
    "20px",
  );
  const strokeOnly = page.getByTestId("effects-stroke-only");
  await expect(strokeOnly).toHaveCSS("border-radius", "0px");
  await expect(strokeOnly).toHaveCSS("border-width", "5px");
  await expect(strokeOnly).toHaveCSS("border-color", "rgb(0, 60, 80)");
  const current = PNG.sync.read(
    await page
      .locator(".rotation-font-benchmark")
      .screenshot({ animations: "disabled" }),
  );
  const baselinePath = join(
    process.cwd(),
    "tests",
    "visual",
    "baselines",
    "rotation-font-benchmark.png",
  );
  if (process.env.UPDATE_VISUAL_BASELINES === "1")
    writeFileSync(baselinePath, PNG.sync.write(current));
  const expected = PNG.sync.read(readFileSync(baselinePath));
  expect({ width: current.width, height: current.height }).toEqual({
    width: expected.width,
    height: expected.height,
  });
  const changed = pixelmatch(
    expected.data,
    current.data,
    undefined,
    expected.width,
    expected.height,
    { threshold: 0.24, includeAA: false },
  );
  expect(
    changed / (expected.width * expected.height),
    "rotation/font fixture visual drift",
  ).toBeLessThanOrEqual(0.1);
});
