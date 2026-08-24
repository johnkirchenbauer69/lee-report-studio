import fs from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { sampleTemplate } from "../src/data/sampleTemplate.ts";
import { buildPresentationModel } from "../src/report-engine/bindings/presentationModel.ts";
import { expandTemplatePages } from "../src/report-engine/generation/repeaters.ts";
import { prepareTemplateForReport } from "../src/report-engine/generation/prepareTemplate.ts";
import { industrialMarketReportSchema } from "../src/report-engine/schema/industrialMarketReport.ts";
import { looksLikeSalesforceId } from "../src/shared/salesforceIds.ts";

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
const selectedIds = report.submarkets
  .map((item) => item.id)
  .filter(Boolean) as string[];
const presentation = buildPresentationModel(report);
const prepared = prepareTemplateForReport(
  sampleTemplate,
  report,
  presentation,
  "ascendix",
  "published",
);
const pages = expandTemplatePages(prepared, presentation, {
  submarketIds: selectedIds,
});
if (
  selected.length !== 18 ||
  selectedIds.length !== 18 ||
  new Set(selectedIds).size !== 18 ||
  pages.length !== 40
)
  throw new Error(
    `Expected 18 selected submarkets and 40 pages; received ${selected.length} and ${pages.length}.`,
  );
const expectedOrder = presentation.submarketDetails.flatMap((detail) => [
  `${detail.displayName} Overview`,
  `${detail.displayName} Highlights`,
]);
if (
  JSON.stringify(pages.slice(4).map((page) => page.name)) !==
  JSON.stringify(expectedOrder)
)
  throw new Error("Detailed page pair order is incorrect.");
if (!selectedIds.includes("i80-joliet"))
  throw new Error("I-80/Joliet canonical submarket was not generated.");
if (!pages.every((page, index) => page.pageNumber === index + 1))
  throw new Error("Expanded page numbers are not sequential 1-40.");
for (const detail of presentation.submarketDetails) {
  if (detail.topLeaseRows.length !== 3 || detail.topSaleRows.length !== 3)
    throw new Error(
      `${detail.displayName} does not have fixed transaction rows.`,
    );
  for (const section of [
    detail.topAvailabilities,
    detail.topDeliveries,
    detail.topConstruction,
  ])
    if (section.length !== 3)
      throw new Error(
        `${detail.displayName} does not have fixed highlight slots.`,
      );
}
const allLeases = [
  ...presentation.leasing,
  ...presentation.submarketDetails.flatMap((detail) => detail.leasing),
];
const confidentialLeases = allLeases.filter(
  (lease) => lease.isDealConfidential === true,
);
if (
  confidentialLeases.some(
    (lease) =>
      lease.tenant !== "(Confidential)" ||
      lease.tenantDisplayName !== "(Confidential)",
  )
)
  throw new Error("A confidential Lease exposed a tenant display name.");
if (
  allLeases.some(
    (lease) =>
      lease.isDealConfidential !== true &&
      lease.tenantDisplayName === "(Confidential)",
  )
)
  throw new Error("A non-confidential Lease was mislabeled confidential.");
const clientFacing = JSON.stringify({
  leasing: presentation.leasing,
  sales: presentation.sales,
  details: presentation.submarketDetails,
  pages,
});
if (clientFacing.includes('"type":"Included"'))
  throw new Error('Client-facing Sale Type contains "Included".');
const clientValue = {
  leasing: presentation.leasing,
  sales: presentation.sales,
  details: presentation.submarketDetails,
};
const strings: string[] = [];
const collectStrings = (value: unknown): void => {
  if (typeof value === "string") strings.push(value);
  else if (Array.isArray(value)) value.forEach(collectStrings);
  else if (value && typeof value === "object")
    Object.values(value).forEach(collectStrings);
};
collectStrings(clientValue);
if (strings.some(looksLikeSalesforceId))
  throw new Error(
    `Client-facing report contains raw Salesforce-like IDs: ${[
      ...new Set(strings.filter(looksLikeSalesforceId)),
    ].join(", ")}.`,
  );
const publishedText = pages
  .flatMap((page) => page.elements)
  .flatMap((element) => (element.type === "text" ? [element.text] : []))
  .join("\n");
if (publishedText.includes("Data unavailable:"))
  throw new Error(
    "Published output contains internal Data unavailable diagnostics.",
  );
if (
  !presentation.submarketDetails.some(
    (detail) => detail.displayName === "Southeast Wisconsin",
  )
)
  throw new Error("Southeast Wisconsin is missing from published headers.");
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
      canonicalSubmarketIds: selectedIds,
      i80JolietIncluded: selectedIds.includes("i80-joliet"),
      sequentialPageNumbers: pages.every(
        (page, index) => page.pageNumber === index + 1,
      ),
      confidentialLeaseRows: confidentialLeases.length,
      saleTypes: [
        ...new Set(
          presentation.submarketDetails.flatMap((detail) =>
            detail.sales.map((sale) => sale.saleType),
          ),
        ),
      ],
      output: "test-results/live-q2-report.pdf",
    },
    null,
    2,
  ),
);
