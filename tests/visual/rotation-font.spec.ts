import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
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
  const current = PNG.sync.read(
    await page
      .locator(".rotation-font-benchmark")
      .screenshot({ animations: "disabled" }),
  );
  const expected = PNG.sync.read(
    readFileSync(
      join(
        process.cwd(),
        "tests",
        "visual",
        "baselines",
        "rotation-font-benchmark.png",
      ),
    ),
  );
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
