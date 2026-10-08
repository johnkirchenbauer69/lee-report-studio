import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MarketingChart } from "../src/report-engine/charts/MarketingChart";
import { managedFontCss } from "../src/services/fontRegistry";
import { getByContextPath } from "../src/engine/bindings";
import { snapshotPresentation, buildExportPlan } from "../src/report-engine/market-assets/discovery";
import { FileSystemAssetStore } from "../server/assets/assetStore";
import { freezePresentation, sourceHash } from "../server/market-assets/snapshot";
import sharp from "sharp";

const root = path.join(process.env.TEMP!, "lee-local-integration-20261008");
const output = path.join(root, "real-i55", "charts"); await mkdir(output, { recursive: true });
const before = await import(pathToFileURL(path.join(root, "before-code", "src/report-engine/charts/MarketingChart.tsx")).href);
const source = JSON.parse(await readFile("server/data/report-instances/report-2e6a2cc9-cefa-4a99-a515-d7404e5662cd.json", "utf8"));
const plan = buildExportPlan(source, { reportId: source.id, markets: ["i55-corridor"], categories: ["charts"], resolution: "standard", transparent: false }, sourceHash(source));
const data = snapshotPresentation(source), store = new FileSystemAssetStore("server/data");
const browser = await chromium.launch({ args: ["--font-render-hinting=none"] });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  for (const asset of plan.assets) {
    const chart = asset.elements!.find(e => e.type === "chart")!;
    const rows = getByContextPath(data, chart.sourcePath, chart.bindingContext);
    const frozen = await freezePresentation(source, [{ ...asset.page!, elements: [chart] }], store);
    const images = [];
    let detail;
    for (const [name, component] of [["before", before.MarketingChart], ["after", MarketingChart]] as const) {
      const html = renderToStaticMarkup(React.createElement(component, { element: chart, source: rows }));
      await page.setContent(`<style>${managedFontCss(frozen.template.assets)}body{margin:0;background:transparent}.marketing-chart{width:1200px;height:650px}.marketing-chart svg{width:100%;height:100%}</style>${html}`);
      await page.evaluate(async () => document.fonts.ready);
      const file = path.join(output, `${chart.marketingChartId}-${name}.png`);
      await page.locator(".marketing-chart").screenshot({ path: file, omitBackground: name === "after" }); images.push(file);
      if (name === "after") detail = { countChips: await page.locator("[data-count-chip]").count(), seriesWarnings: await page.locator("[data-unavailable-series]").allTextContents(), svg: await page.locator("svg").getAttribute("viewBox") };
    }
    const checker = Buffer.from(`<svg width="2400" height="650"><defs><pattern id="c" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#f3f3f3"/><rect width="12" height="12" fill="#ddd"/><rect x="12" y="12" width="12" height="12" fill="#ddd"/></pattern></defs><rect width="2400" height="650" fill="url(#c)"/></svg>`);
    await sharp(checker).composite([{ input: images[0], left: 0, top: 0 }, { input: images[1], left: 1200, top: 0 }]).png().toFile(path.join(output, `${chart.marketingChartId}-comparison.png`));
    results.push({ chart: chart.marketingChartId, before: images[0], after: images[1], ...detail });
  }
  await writeFile(path.join(output, "comparison.json"), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
