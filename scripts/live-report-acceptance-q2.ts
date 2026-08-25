import fs from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { sampleTemplate } from "../src/data/sampleTemplate.ts";
import { buildPresentationModel } from "../src/report-engine/bindings/presentationModel.ts";
import { expandTemplatePages } from "../src/report-engine/generation/repeaters.ts";
import { prepareTemplateForReport } from "../src/report-engine/generation/prepareTemplate.ts";
import { industrialMarketReportSchema } from "../src/report-engine/schema/industrialMarketReport.ts";
import { looksLikeSalesforceId } from "../src/shared/salesforceIds.ts";
import { evaluateReportReadiness } from "../src/report-engine/validation/reportValidation.ts";

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
const readiness = evaluateReportReadiness(report, sampleTemplate, "ascendix");
const inventory65200 = report.provenance.find(
  (record) => record.reconciliation?.varianceAbsolute === 65_200,
);
if (
  inventory65200?.reconciliation?.classification !== "warning" ||
  inventory65200.fieldPath !==
    "reconciliation.submarkets.Chicago South.inventorySf"
)
  throw new Error(
    `Expected the visible 65,200 SF Chicago South reconciliation warning; received ${JSON.stringify(inventory65200?.reconciliation)}.`,
  );
if (
  inventory65200.selectedValue !==
    report.submarkets.find((item) => item.name === "Chicago South")
      ?.inventorySf ||
  inventory65200.selectedValue !==
    inventory65200.reconciliation.authoritativeValue
)
  throw new Error(
    "Chicago South reconciliation did not preserve authoritative Market_Data inventory.",
  );
const inventory65200Issue = readiness.issues.find(
  (issue) => issue.path === inventory65200.fieldPath,
);
if (inventory65200Issue?.level !== "warning")
  throw new Error(
    `Expected the 65,200 SF reconciliation to remain visible as a warning; received ${inventory65200Issue?.level ?? "no issue"}.`,
  );
if (readiness.blockers.some((issue) => issue.path === inventory65200.fieldPath))
  throw new Error(
    "The 65,200 SF reconciliation incorrectly blocks publication.",
  );
if (
  !inventory65200.reconciliation.details?.diagnosticOnly ||
  !inventory65200.reconciliation.details.records.length ||
  inventory65200.reconciliation.details.records.some(
    (record) => record.expectedOfficialScope !== null,
  )
)
  throw new Error(
    "Chicago South reconciliation details must remain populated, diagnostic-only, and explicit that official row-level scope is unknown.",
  );

const westCookInventory = report.provenance.find(
  (record) =>
    record.fieldPath === "reconciliation.submarkets.West Cook.inventorySf",
);
if (westCookInventory?.reconciliation?.classification !== "known-difference")
  throw new Error(
    `Expected the approved West Cook reconciliation finding; received ${JSON.stringify(westCookInventory?.reconciliation)}.`,
  );
if (
  westCookInventory.selectedValue !==
    report.submarkets.find((item) => item.name === "West Cook")?.inventorySf ||
  westCookInventory.selectedValue !==
    westCookInventory.reconciliation.authoritativeValue
)
  throw new Error(
    "West Cook reconciliation did not preserve authoritative Market_Data inventory.",
  );
const westCookIssue = readiness.issues.find(
  (issue) => issue.path === westCookInventory.fieldPath,
);
if (westCookIssue?.level !== "warning")
  throw new Error(
    `Expected West Cook reconciliation to remain visible as a warning; received ${westCookIssue?.level ?? "no issue"}.`,
  );
if (
  readiness.blockers.some((issue) => issue.path === westCookInventory.fieldPath)
)
  throw new Error(
    "Known West Cook reconciliation incorrectly blocks publication.",
  );
if (
  !westCookInventory.reconciliation.details?.diagnosticOnly ||
  !westCookInventory.reconciliation.details.records.length ||
  westCookInventory.reconciliation.details.records.some(
    (record) => record.expectedOfficialScope !== null,
  )
)
  throw new Error(
    "West Cook reconciliation details must remain populated, diagnostic-only, and explicit that official row-level scope is unknown.",
  );
for (const record of report.provenance.filter(
  (item) => item.reconciliation?.classification === "blocking",
))
  if (!readiness.blockers.some((issue) => issue.path === record.fieldPath))
    throw new Error(
      `Material reconciliation blocker was incorrectly downgraded: ${record.fieldPath}.`,
    );
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
  pages.length !== 44
)
  throw new Error(
    `Expected 18 selected submarkets and 44 pages; received ${selected.length} and ${pages.length}.`,
  );
const expectedOrder = presentation.submarketDetails.flatMap((detail) => [
  `${detail.displayName} Overview`,
  `${detail.displayName} Highlights`,
]);
if (
  JSON.stringify(pages.slice(4, 40).map((page) => page.name)) !==
  JSON.stringify(expectedOrder)
)
  throw new Error("Detailed page pair order is incorrect.");
const staticPages = pages.slice(40);
if (
  JSON.stringify(staticPages.map((page) => page.name)) !==
  JSON.stringify(["Data Methodology", "Definitions", "Contacts", "Who We Are"])
)
  throw new Error("Static pages 41-44 are missing or out of order.");
for (const page of staticPages.slice(0, 3))
  if (
    !page.elements.some(
      (element) =>
        element.type === "text" &&
        element.name === "Quarter" &&
        element.text === "Q2 2026" &&
        element.binding?.path === "reportDisplay.period",
    )
  )
    throw new Error(`${page.name} is missing its dynamic Q2 2026 header.`);
if (staticPages[3]!.elements.some((element) => element.binding))
  throw new Error("Who We Are must remain fully static.");
if (!selectedIds.includes("i80-joliet"))
  throw new Error("I-80/Joliet canonical submarket was not generated.");
if (!pages.every((page, index) => page.pageNumber === index + 1))
  throw new Error("Expanded page numbers are not sequential 1-44.");
const overallMap = pages[2]!.elements.find(
  (element) => element.id === "market-map",
);
if (
  overallMap?.type !== "image" ||
  overallMap.src !== "/report-assets/maps/Overall_Market_Map.jpg"
)
  throw new Error("Overall Market Overview did not resolve its managed map.");
presentation.submarketDetails.forEach((detail, index) => {
  const map = pages[4 + index * 2]!.elements.find((element) =>
    element.id.includes("market-map"),
  );
  if (map?.type !== "image" || map.src !== detail.mapAssetUrl)
    throw new Error(
      `${detail.displayName} Overview did not resolve its canonical managed map.`,
    );
});
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
const unknownConfidentialityLeases = allLeases.filter(
  (lease) =>
    lease.isDealConfidential !== true && lease.isDealConfidential !== false,
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
  unknownConfidentialityLeases.some(
    (lease) =>
      lease.tenant !== "(Confidential)" ||
      lease.tenantDisplayName !== "(Confidential)",
  )
)
  throw new Error("A Lease with unknown confidentiality exposed a tenant.");
if (
  allLeases.some(
    (lease) =>
      lease.isDealConfidential === false &&
      lease.tenantDisplayName === "(Confidential)",
  )
)
  throw new Error(
    "A verified non-confidential Lease was mislabeled confidential.",
  );
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
if (pdf.getPageCount() !== 44)
  throw new Error(`Expected a 44-page PDF; received ${pdf.getPageCount()}.`);
const output = "output/pdf/chicago-industrial-market-report-q2-2026.pdf";
await fs.mkdir("output/pdf", { recursive: true });
await fs.writeFile(output, pdfBytes);
console.log(
  JSON.stringify(
    {
      selectedSubmarkets: selected.length,
      pages: pages.length,
      pdfPages: pdf.getPageCount(),
      firstPages: pages.slice(0, 6).map((page) => page.name),
      lastPages: pages.slice(-4).map((page) => page.name),
      availabilitySponsors: report.availabilities
        .map((item) => item.sponsor)
        .filter(Boolean),
      canonicalSubmarketIds: selectedIds,
      i80JolietIncluded: selectedIds.includes("i80-joliet"),
      sequentialPageNumbers: pages.every(
        (page, index) => page.pageNumber === index + 1,
      ),
      confidentialLeaseRows: confidentialLeases.length,
      unknownConfidentialityLeaseRows: unknownConfidentialityLeases.length,
      westCookInventoryReconciliation: {
        authoritativeValue: westCookInventory.reconciliation.authoritativeValue,
        propertyDataValue: westCookInventory.reconciliation.comparisonValue,
        varianceAbsolute: westCookInventory.reconciliation.varianceAbsolute,
        variancePercentage: westCookInventory.reconciliation.variancePercentage,
        classification: westCookInventory.reconciliation.classification,
        qaSeverity: westCookIssue.level,
        detailDetermination:
          westCookInventory.reconciliation.details.determination,
        candidateRecordCount:
          westCookInventory.reconciliation.details.records.length,
      },
      inventory65200Reconciliation: {
        path: inventory65200.fieldPath,
        authoritativeValue: inventory65200.reconciliation.authoritativeValue,
        propertyDataValue: inventory65200.reconciliation.comparisonValue,
        varianceAbsolute: inventory65200.reconciliation.varianceAbsolute,
        variancePercentage: inventory65200.reconciliation.variancePercentage,
        classification: inventory65200.reconciliation.classification,
        qaSeverity: inventory65200Issue.level,
        detailDetermination:
          inventory65200.reconciliation.details.determination,
        candidateRecordCount:
          inventory65200.reconciliation.details.records.length,
      },
      saleTypes: [
        ...new Set(
          presentation.submarketDetails.flatMap((detail) =>
            detail.sales.map((sale) => sale.saleType),
          ),
        ),
      ],
      output,
    },
    null,
    2,
  ),
);
