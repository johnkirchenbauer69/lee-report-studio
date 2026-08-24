import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const pages = [
  "cover",
  "overall-market-table",
  "market-overview",
  "market-highlights",
];
const maximumDifference = {
  cover: 0.08,
  "overall-market-table": 0.06,
  "market-overview": 0.12,
  "market-highlights": 0.12,
} as const;

for (const [pageIndex, name] of pages.entries())
  test(`Page ${pageIndex + 1} — ${name}`, async ({ page }, testInfo) => {
    await page.goto(`/?benchmark=1&page=${pageIndex}`, { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images).map((image) =>
          image.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                image.addEventListener("load", () => resolve(), { once: true });
                image.addEventListener("error", () => resolve(), {
                  once: true,
                });
              }),
        ),
      );
    });
    const currentBuffer = await page
      .locator(".benchmark-page")
      .screenshot({ animations: "disabled" });
    const baselinePath = join(
      testInfo.config.rootDir,
      "baselines",
      `${name}.png`,
    );
    if (process.env.UPDATE_VISUAL_BASELINES === "1") {
      mkdirSync(dirname(baselinePath), { recursive: true });
      writeFileSync(baselinePath, currentBuffer);
      return;
    }
    const expected = PNG.sync.read(readFileSync(baselinePath)),
      current = PNG.sync.read(currentBuffer);
    expect({ width: current.width, height: current.height }).toEqual({
      width: expected.width,
      height: expected.height,
    });
    const diff = new PNG({ width: expected.width, height: expected.height });
    const changed = pixelmatch(
      expected.data,
      current.data,
      diff.data,
      expected.width,
      expected.height,
      {
        threshold: 0.24,
        includeAA: false,
        diffColor: [220, 20, 60],
        aaColor: [255, 190, 0],
      },
    );
    const ratio = changed / (expected.width * expected.height),
      similarity = (1 - ratio) * 100;
    const currentPath = testInfo.outputPath(`${name}-current.png`),
      diffPath = testInfo.outputPath(`${name}-diff.png`),
      expectedPath = testInfo.outputPath(`${name}-expected.png`);
    writeFileSync(currentPath, currentBuffer);
    writeFileSync(diffPath, PNG.sync.write(diff));
    writeFileSync(expectedPath, PNG.sync.write(expected));
    await testInfo.attach("current", {
      path: currentPath,
      contentType: "image/png",
    });
    await testInfo.attach("expected", {
      path: expectedPath,
      contentType: "image/png",
    });
    await testInfo.attach("diff", { path: diffPath, contentType: "image/png" });
    console.log(
      `Page ${pageIndex + 1} — ${name}: ${similarity.toFixed(2)}% similarity`,
    );
    expect(
      ratio,
      `${name} similarity ${similarity.toFixed(2)}% fell below ${(1 - maximumDifference[name]) * 100}%`,
    ).toBeLessThanOrEqual(maximumDifference[name]);
  });

test("Highlight cards distinguish missing images from missing records", async ({
  page,
}) => {
  await page.goto("/?benchmark=1&page=3&highlightStates=1", {
    waitUntil: "load",
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const report = page.locator(".benchmark-page");
  await expect(
    report.getByText("Image unavailable", { exact: true }),
  ).toHaveCount(1);
  await expect(report.getByText("None to Report", { exact: true })).toHaveCount(
    5,
  );
  await expect(report).toHaveScreenshot("highlight-card-states.png");
});
