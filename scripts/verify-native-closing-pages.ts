import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { generateReportInstance } from "../src/report-engine/generation/generateReport.ts";
import { buildPresentationModel } from "../src/report-engine/bindings/presentationModel.ts";
import type { ReportTemplate } from "../src/types/report.ts";

// Uses the existing local API and print route; source data is the sample provider.
const api = process.env.LEE_QA_API_URL ?? "http://127.0.0.1:8787";
const app = process.env.LEE_QA_APP_URL ?? "http://127.0.0.1:3108";
const version = process.env.LEE_QA_TEMPLATE_VERSION ?? "1.21.0";
const out = "output/design-consistency";
await mkdir(out, { recursive: true });
const response = await fetch(`${api}/api/templates/industrial-market-report/versions/${version}`);
if (!response.ok) throw new Error(`Template load failed: ${response.status}`);
const stored = await response.json();
const template: ReportTemplate = stored.template;
const instance = await generateReportInstance(template, {
  templateId: template.id, templateVersion: template.version, market: "Chicago", period: "2026 Q2",
  calculationScope: { type: "all-submarkets" }, pageSelection: {}, source: { provider: "sample" },
});
const report = { ...template, pages: instance.pages };
const data = buildPresentationModel(instance.dataSnapshot);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 1 });
  await page.route("**/api/render-jobs/native-closing-qa", route => route.fulfill({ json: { template: report, data, title: "Native closing pages QA" } }));
  await page.goto(`${app}/?printJob=native-closing-qa`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-render-ready="true"]');
  const metrics = await page.locator(".closing-content").evaluateAll(nodes => nodes.map(node => ({
    className: node.className, height: node.clientHeight, contentHeight: node.scrollHeight,
    width: node.clientWidth, contentWidth: node.scrollWidth,
    companyCopyBottom: node.querySelector(".closing-company-copy")?.getBoundingClientRect().bottom,
    growthTop: node.querySelector(".closing-growth")?.getBoundingClientRect().top,
  })));
  const indicators = await page.locator(".table-indicators").evaluateAll(tables => tables.map(table => ({
    font: getComputedStyle(table).fontFamily, size: getComputedStyle(table).fontSize,
    weights: Array.from(table.querySelectorAll("tbody tr:first-child td")).map(cell => getComputedStyle(cell).fontWeight),
    borders: Array.from(table.querySelectorAll("tbody tr:first-child td")).map(cell => getComputedStyle(cell).borderBottomWidth),
  })));
  const images = await page.locator(".closing-content img").evaluateAll(images => images.map(image => ({ src: (image as HTMLImageElement).src, loaded: (image as HTMLImageElement).naturalWidth > 0 })));
  await writeFile(`${out}/layout-metrics.json`, JSON.stringify({ pageCount: instance.pages.length, metrics, indicators, images }, null, 2));
  for (const id of ["data-methodology", "definitions", "contacts", "who-we-are", "market-overview", "submarket-overview-repeat-0"])
    await page.locator(".print-page").nth(instance.pages.findIndex(p => p.id === id)).screenshot({ path: `${out}/${id}.png` });
  if (metrics.some(m => m.contentHeight > m.height + 1 || m.contentWidth > m.width + 1 || (m.companyCopyBottom != null && m.growthTop != null && m.companyCopyBottom > m.growthTop)))
    throw new Error("Closing page overflow detected; see layout-metrics.json");
  const result = await fetch(`${api}/api/render/pdf`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template: report, data, title: "Native closing pages QA", renderMode: "draft" }) });
  if (!result.ok) throw new Error(`PDF export failed: ${result.status} ${await result.text()}`);
  await writeFile(`${out}/full-report.pdf`, new Uint8Array(await result.arrayBuffer()));
  console.log(JSON.stringify({ pageCount: instance.pages.length, metrics, indicators: indicators.length, images }, null, 2));
} finally { await browser.close(); }
