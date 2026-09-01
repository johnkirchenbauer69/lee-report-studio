import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const pages = [
  { index: 0, number: 1, name: "cover" },
  { index: 1, number: 2, name: "overall-market-table" },
  { index: 2, number: 3, name: "market-overview" },
  { index: 3, number: 4, name: "market-highlights" },
  { index: 6, number: 41, name: "data-methodology" },
  { index: 7, number: 42, name: "definitions" },
  { index: 8, number: 43, name: "contacts" },
  { index: 9, number: 44, name: "who-we-are" },
] as const;
const maximumDifference = {
  cover: 0.08,
  "overall-market-table": 0.06,
  "market-overview": 0.12,
  "market-highlights": 0.12,
  "data-methodology": 0.03,
  definitions: 0.03,
  contacts: 0.03,
  "who-we-are": 0.03,
} as const;

for (const { index, number, name } of pages)
  test(`Page ${number} — ${name}`, async ({ page }, testInfo) => {
    await page.goto(`/?benchmark=1&page=${index}`, { waitUntil: "load" });
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
    if (name === "market-overview") {
      await expect(page.getByText("LEE DEAL", { exact: true })).toHaveCount(2);
      await expect(page.locator('[data-testid="lee-deal-chip"]')).toHaveCount(
        2,
      );
      const chipLayout = await page
        .locator(".transaction-type-cell:has(.lee-deal-chip)")
        .evaluateAll((cells) =>
          cells.map((cell) => {
            const value = cell.querySelector(".transaction-type-value")!;
            const chip = cell.querySelector(".lee-deal-chip")!;
            const cellBox = cell.getBoundingClientRect();
            const valueBox = value.getBoundingClientRect();
            const chipBox = chip.getBoundingClientRect();
            return {
              noOverlap: valueBox.right <= chipBox.left,
              chipInside:
                chipBox.left >= cellBox.left && chipBox.right <= cellBox.right,
              verticallyCentered:
                Math.abs(
                  (chipBox.top + chipBox.bottom) / 2 -
                    (cellBox.top + cellBox.bottom) / 2,
                ) < 1,
            };
          }),
        );
      expect(chipLayout).toEqual([
        { noOverlap: true, chipInside: true, verticallyCentered: true },
        { noOverlap: true, chipInside: true, verticallyCentered: true },
      ]);
    }
    if (["data-methodology", "definitions", "contacts"].includes(name))
      await expect(page.getByText("Q2 2026", { exact: true })).toHaveCount(1);
    if (name === "data-methodology") {
      await expect(page.getByTestId("data-methodology-logo")).toHaveCount(1);
      await expect(page.getByTestId("data-methodology-title")).toHaveCount(1);
      await expect(
        page.getByText("DATA METHODOLOGY", { exact: true }),
      ).toHaveCount(1);
    }
    if (name === "definitions") {
      await expect(page.getByTestId("definitions-logo")).toHaveCount(1);
      await expect(page.getByTestId("definitions-title")).toHaveCount(1);
      await expect(page.getByText("DEFINITIONS", { exact: true })).toHaveCount(
        1,
      );
    }
    if (name === "contacts") {
      await expect(page.getByTestId("contacts-logo")).toHaveCount(1);
      await expect(page.getByTestId("contacts-period")).toHaveCount(1);
      await expect(page.getByTestId("contacts-title")).toHaveCount(0);
    }
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
      `Page ${number} — ${name}: ${similarity.toFixed(2)}% similarity`,
    );
    expect(
      ratio,
      `${name} similarity ${similarity.toFixed(2)}% fell below ${(1 - maximumDifference[name]) * 100}%`,
    ).toBeLessThanOrEqual(maximumDifference[name]);
  });

test("Highlight cards distinguish missing images from missing records", async ({
  page,
}, testInfo) => {
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
  const currentBuffer = await report.screenshot({ animations: "disabled" });
  const baselinePath = join(
    testInfo.config.rootDir,
    "baselines",
    "highlight-card-states.png",
  );
  if (process.env.UPDATE_VISUAL_BASELINES === "1") {
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, currentBuffer);
    return;
  }
  const expected = PNG.sync.read(readFileSync(baselinePath));
  const current = PNG.sync.read(currentBuffer);
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
    { threshold: 0.24, includeAA: false },
  );
  const ratio = changed / (expected.width * expected.height);
  for (const [name, buffer] of [
    ["highlight-card-states-current.png", currentBuffer],
    ["highlight-card-states-diff.png", PNG.sync.write(diff)],
  ] as const) {
    const path = testInfo.outputPath(name);
    writeFileSync(path, buffer);
    await testInfo.attach(name, { path, contentType: "image/png" });
  }
  expect(ratio).toBeLessThanOrEqual(0.12);
});
