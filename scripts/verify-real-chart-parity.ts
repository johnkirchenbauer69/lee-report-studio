import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { strict as assert } from "node:assert";
import sharp from "sharp";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { buildExportPlan, elementBounds } from "../src/report-engine/market-assets/discovery";
import { FileSystemAssetStore } from "../server/assets/assetStore";
import { freezePresentation, sourceHash } from "../server/market-assets/snapshot";

const root = path.join(process.env.TEMP!, "lee-local-integration-20261008", "real-i55");
const source = JSON.parse(await readFile("server/data/report-instances/report-2e6a2cc9-cefa-4a99-a515-d7404e5662cd.json", "utf8"));
const plan = buildExportPlan(source, { reportId: source.id, markets: ["i55-corridor"], categories: ["charts"], resolution: "standard", transparent: false }, sourceHash(source));
const store = new FileSystemAssetStore("server/data");
const browser = await chromium.launch({ args: ["--font-render-hinting=none"] });
const results = [];
try {
  for (const asset of plan.assets) {
    const bounds = asset.elements!.map(elementBounds);
    const x = Math.min(...bounds.map(b => b.x)) - 4, y = Math.min(...bounds.map(b => b.y)) - 4;
    const width = Math.max(...bounds.map(b => b.x + b.width)) - x + 4, height = Math.max(...bounds.map(b => b.y + b.height)) - y + 4;
    // Compare only the selected saved chart. Old unpinned photographs are not substituted.
    const frozen = await freezePresentation(source, [{ ...asset.page!, elements: asset.elements! }], store);
    const context = await browser.newContext({ deviceScaleFactor: 1200 / width, viewport: { width: 900, height: 1120 } });
    const page = await context.newPage();
    await page.route("**/api/render-jobs/real-chart-parity", route => route.fulfill({ json: frozen }));
    await page.goto("http://localhost:3000/?printJob=real-chart-parity");
    await page.locator('[data-render-ready="true"]').waitFor(); await page.evaluate(() => document.fonts.ready);
    const origin = (await page.locator(".print-page").boundingBox())!;
    const reference = await page.screenshot({ clip: { x: origin.x + x, y: origin.y + y, width, height } });
    const expected = PNG.sync.read(reference), actual = PNG.sync.read(await sharp(await readFile(path.join(root, path.basename(asset.path)))).flatten({ background: asset.page!.background || "#ffffff" }).png().toBuffer());
    assert.equal(actual.width, expected.width); assert.equal(actual.height, expected.height);
    const difference = pixelmatch(actual.data, expected.data, undefined, actual.width, actual.height, { threshold: .1 }) / (actual.width * actual.height);
    assert.ok(difference < .003, `${asset.title}: ${difference}`);
    await writeFile(path.join(root, "charts", `${asset.title}-saved-page-reference.png`), reference);
    results.push({ chart: asset.title, difference, countChips: await page.locator("[data-count-chip]").count(), dimensions: [actual.width, actual.height] });
    await context.close();
  }
  await writeFile(path.join(root, "charts", "real-chart-parity.json"), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
