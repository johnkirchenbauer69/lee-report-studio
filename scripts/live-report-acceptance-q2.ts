import fs from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { sampleTemplate } from "../src/data/sampleTemplate.ts";
import { buildPresentationModel } from "../src/report-engine/bindings/presentationModel.ts";
import { expandTemplatePages } from "../src/report-engine/generation/repeaters.ts";
import { prepareTemplateForReport } from "../src/report-engine/generation/prepareTemplate.ts";
import { industrialMarketReportSchema } from "../src/report-engine/schema/industrialMarketReport.ts";

const api = process.env.LEE_API_URL ?? "http://127.0.0.1:8787";
const response = await fetch(`${api}/api/report-data/industrial-market`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    reportType: "industrial-market-report",
    market: "Chicago",
    period: "2026 Q2",
    calculationScope: { type: "all-submarkets" },
    timeContext: { type: "historical-period", period: "2026 Q2" },
  }),
});
if (!response.ok)
  throw new Error(
    `Live report data request failed: ${response.status} ${await response.text()}`,
  );
const envelope = (await response.json()) as { report: unknown };
const report = industrialMarketReportSchema.parse(envelope.report);
const selected = report.submarkets.map((item) => item.name);
const presentation = buildPresentationModel(report);
const prepared = prepareTemplateForReport(
  sampleTemplate,
  report,
  presentation,
  "ascendix",
);
const pages = expandTemplatePages(prepared, presentation, {
  submarkets: selected,
});
if (selected.length !== 18 || pages.length !== 40)
  throw new Error(
    `Expected 18 selected submarkets and 40 pages; received ${selected.length} and ${pages.length}.`,
  );
const expectedOrder = selected.flatMap((name) => [
  `${name} Overview`,
  `${name} Highlights`,
]);
if (
  JSON.stringify(pages.slice(4).map((page) => page.name)) !==
  JSON.stringify(expectedOrder)
)
  throw new Error("Detailed page pair order is incorrect.");
const pdfResponse = await fetch(`${api}/api/render/pdf`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    template: {
      ...sampleTemplate,
      name: "2026 Q2 Chicago Industrial Market Report",
      pages,
    },
    data: presentation,
    title: "2026 Q2 Chicago Industrial Market Report",
  }),
});
if (!pdfResponse.ok)
  throw new Error(
    `Chromium PDF request failed: ${pdfResponse.status} ${await pdfResponse.text()}`,
  );
const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
const pdf = await PDFDocument.load(pdfBytes);
if (pdf.getPageCount() !== 40)
  throw new Error(`Expected a 40-page PDF; received ${pdf.getPageCount()}.`);
await fs.mkdir("test-results", { recursive: true });
await fs.writeFile("test-results/live-q2-report.pdf", pdfBytes);
console.log(
  JSON.stringify(
    {
      selectedSubmarkets: selected.length,
      pages: pages.length,
      pdfPages: pdf.getPageCount(),
      firstPages: pages.slice(0, 6).map((page) => page.name),
      lastPages: pages.slice(-2).map((page) => page.name),
      availabilitySponsors: report.availabilities
        .map((item) => item.sponsor)
        .filter(Boolean),
      output: "test-results/live-q2-report.pdf",
    },
    null,
    2,
  ),
);
