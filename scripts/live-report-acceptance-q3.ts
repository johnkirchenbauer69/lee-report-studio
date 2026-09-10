import fs from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { MARKET_MAP_ASSET_REGISTRY } from "../src/report-engine/assets/marketMapAssets.ts";
import { buildPresentationModel } from "../src/report-engine/bindings/presentationModel.ts";
import { generateReportInstance } from "../src/report-engine/generation/generateReport.ts";
import { prepareTemplateForReport } from "../src/report-engine/generation/prepareTemplate.ts";
import { expandTemplatePages } from "../src/report-engine/generation/repeaters.ts";
import { CHICAGO_SUBMARKETS } from "../src/report-engine/submarkets.ts";
import { resolveApiBaseUrl } from "../src/shared/apiBaseUrl.ts";
import { normalizeReportTemplateFonts } from "../src/services/templateNormalization.ts";
import type { Asset, ReportTemplate } from "../src/types/report.ts";

const period = "2026 Q3";
const api = resolveApiBaseUrl({ environment: process.env });
const output =
  process.env.LEE_ACCEPT_PDF_OUTPUT ??
  "output/pdf/chicago-industrial-market-report-q3-2026.pdf";

const [periodsResponse, templatesResponse, assetsResponse] = await Promise.all([
  fetch(`${api}/api/report-data/industrial-market/periods`),
  fetch(`${api}/api/templates`),
  fetch(`${api}/api/assets`),
]);
if (!periodsResponse.ok || !templatesResponse.ok || !assetsResponse.ok)
  throw new Error("Period, template, or asset discovery is unavailable.");

const periodPayload = (await periodsResponse.json()) as {
  periods: Array<{ label: string; periodEnd: string; submarketCount: number }>;
};
if (
  periodPayload.periods[0]?.label !== period ||
  periodPayload.periods[0]?.periodEnd !== "2026-09-30" ||
  periodPayload.periods[0]?.submarketCount !== 18
)
  throw new Error("Q3 is not the newest complete Market_Data report period.");

const templates = (await templatesResponse.json()) as {
  templates: Array<{
    id: string;
    version: string;
    status: "draft" | "published" | "archived";
  }>;
};
const requestedVersion = process.env.LEE_ACCEPT_TEMPLATE_VERSION;
const selectedTemplate = requestedVersion
  ? templates.templates.find((item) => item.version === requestedVersion)
  : templates.templates.find((item) => item.status === "published");
if (!selectedTemplate) throw new Error("A published template is required.");

const storedTemplateResponse = await fetch(
  `${api}/api/templates/${encodeURIComponent(selectedTemplate.id)}/versions/${encodeURIComponent(selectedTemplate.version)}`,
);
if (!storedTemplateResponse.ok)
  throw new Error("The selected template version could not be loaded.");
const stored = (await storedTemplateResponse.json()) as {
  template: ReportTemplate;
};
const assets = ((await assetsResponse.json()) as { assets: Asset[] }).assets;
const template = normalizeReportTemplateFonts(
  { ...stored.template, assets },
  assets,
);

const instance = await generateReportInstance(template, {
  templateId: selectedTemplate.id,
  templateVersion: selectedTemplate.version,
  market: "Chicago",
  period,
  calculationScope: { type: "all-submarkets" },
  pageSelection: {
    submarketIds: CHICAGO_SUBMARKETS.map((submarket) => submarket.id),
  },
  source: { provider: "ascendix" },
});
if (
  instance.generationRequest.period !== period ||
  instance.dataSnapshot.report.period !== period
)
  throw new Error("Q3 did not survive ReportInstance creation.");
if (
  instance.dataSnapshot.submarkets.length !== 18 ||
  instance.pages.length !== 44 ||
  instance.narratives.length !== 19
)
  throw new Error(
    `Expected 18 submarkets, 44 pages, and 19 narratives; received ${instance.dataSnapshot.submarkets.length}, ${instance.pages.length}, and ${instance.narratives.length}.`,
  );
if (
  !instance.dataSnapshot.provenance.some(
    (record) =>
      record.fieldPath.startsWith("overallMarket.") &&
      record.authority.includes("Property_Data__c"),
  )
)
  throw new Error("Overall Market was not derived from Property_Data__c.");
if (
  instance.dataSnapshot.leasing.some(
    (lease) =>
      lease.isDealConfidential !== false &&
      (lease.tenant !== "(Confidential)" ||
        lease.tenantDisplayName !== "(Confidential)"),
  )
)
  throw new Error("Lease confidentiality did not remain fail-closed.");

const persistedResponse = await fetch(`${api}/api/report-instances`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(instance),
});
if (!persistedResponse.ok)
  throw new Error(
    `ReportInstance persistence failed: ${persistedResponse.status} ${await persistedResponse.text()}`,
  );

const presentation = buildPresentationModel(instance.dataSnapshot);
const publishedTemplate = prepareTemplateForReport(
  template,
  instance.dataSnapshot,
  presentation,
  "ascendix",
  "published",
);
const publishedPages = expandTemplatePages(publishedTemplate, presentation, {
  submarketIds: CHICAGO_SUBMARKETS.map((submarket) => submarket.id),
});
if (publishedPages.length !== 44)
  throw new Error(
    `Expected 44 publication-prepared pages; received ${publishedPages.length}.`,
  );

const renderedMaps = publishedPages
  .flatMap((page) => page.elements)
  .filter(
    (element) => element.type === "image" && element.id.includes("market-map"),
  );
const expectedMaps = Object.values(MARKET_MAP_ASSET_REGISTRY);
if (
  renderedMaps.length !== expectedMaps.length ||
  new Set(renderedMaps.map((element) => element.src)).size !==
    expectedMaps.length ||
  expectedMaps.some(
    (src) =>
      !renderedMaps.some(
        (element) => element.type === "image" && element.src === src,
      ),
  )
)
  throw new Error(
    `Expected all ${expectedMaps.length} canonical market maps; received ${renderedMaps.length}.`,
  );
for (const [name, expectedSrc] of [
  ["Central DuPage", MARKET_MAP_ASSET_REGISTRY["central-dupage"]],
  ["Chicago South", MARKET_MAP_ASSET_REGISTRY["chicago-south"]],
  ["O'Hare", MARKET_MAP_ASSET_REGISTRY.ohare],
] as const) {
  const page = publishedPages.find(
    (candidate) => candidate.name === `${name} Overview`,
  );
  const map = page?.elements.find((element) =>
    element.id.includes("market-map"),
  );
  if (map?.type !== "image" || map.src !== expectedSrc)
    throw new Error(`${name} did not render its canonical governed map.`);
}

const reportScopes = [
  { name: "Overall Market", report: instance.dataSnapshot },
  ...instance.dataSnapshot.submarketDetails.map((report) => ({
    name: report.name,
    report,
  })),
];
const contributorCards = reportScopes.flatMap(({ name, report }) =>
  (
    [
      ["availability", report.availabilities],
      ["delivery", report.deliveries],
      ["construction", report.construction],
    ] as const
  ).flatMap(([section, cards]) =>
    cards.map((card, index) => ({ name, section, index, card })),
  ),
);
const resolvedContributorImages = contributorCards.filter(({ card }) =>
  card.image.startsWith("/api/assets/"),
);
const unresolvedPopulatedCards = contributorCards.filter(
  ({ card }) => !card.image,
);
if (
  contributorCards.some(
    ({ card }) => card.image && !card.image.startsWith("/api/assets/"),
  )
)
  throw new Error(
    "A populated Q3 contributor image is not frozen in the immutable Studio asset store.",
  );

const assertRenderedImages = (
  market: string,
  section: "availability" | "deliveries" | "construction",
  expected: number,
) => {
  const page = publishedPages.find(
    (candidate) => candidate.name === `${market} Highlights`,
  );
  const actual = page?.elements.filter(
    (element) =>
      element.type === "image" &&
      element.id.startsWith(`detail-${section}-image-`) &&
      element.src.startsWith("/api/assets/"),
  ).length;
  if (actual !== expected)
    throw new Error(
      `${market} ${section} rendered ${actual ?? 0} property images; expected ${expected}.`,
    );
};
assertRenderedImages("Central DuPage", "availability", 3);
assertRenderedImages("I-55 Corridor", "availability", 3);
assertRenderedImages("I-55 Corridor", "construction", 3);
assertRenderedImages("O'Hare", "availability", 3);
assertRenderedImages("O'Hare", "deliveries", 1);
assertRenderedImages("O'Hare", "construction", 3);

const title = `${period} Chicago Industrial Market Report`;
const pdfResponse = await fetch(`${api}/api/render/pdf`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    template: { ...template, name: title, pages: publishedPages },
    data: presentation,
    title,
  }),
});
if (!pdfResponse.ok)
  throw new Error(
    `Q3 PDF generation failed: ${pdfResponse.status} ${await pdfResponse.text()}`,
  );
const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
const pdf = await PDFDocument.load(pdfBytes);
if (pdf.getPageCount() !== 44)
  throw new Error(`Expected a 44-page Q3 PDF; received ${pdf.getPageCount()}.`);
await fs.mkdir("output/pdf", { recursive: true });
await fs.writeFile(output, pdfBytes);

console.log(
  JSON.stringify(
    {
      period,
      periodEnd: periodPayload.periods[0].periodEnd,
      canonicalSubmarkets: instance.dataSnapshot.submarkets.length,
      propertyDataOverallMarket: true,
      unavailableRentSubmarkets: instance.dataSnapshot.submarkets
        .filter((submarket) => submarket.askingNetRentPsf === 0)
        .map((submarket) => submarket.name),
      narratives: instance.narratives.length,
      persistedReportInstanceId: instance.id,
      pages: instance.pages.length,
      pdfPages: pdf.getPageCount(),
      pdfMode: "publication-prepared",
      marketMaps: {
        resolved: renderedMaps.length,
        expected: expectedMaps.length,
      },
      contributorImages: {
        totalSlots: reportScopes.length * 9,
        populatedCards: contributorCards.length,
        resolved: resolvedContributorImages.length,
        unavailable: reportScopes.length * 9 - resolvedContributorImages.length,
        noRankedContributor: reportScopes.length * 9 - contributorCards.length,
        unresolvedPopulatedCard: unresolvedPopulatedCards.length,
      },
      imageDiagnostics: (instance.sourceMetadata.diagnostics ?? []).filter(
        (diagnostic) => /image|attachment/i.test(diagnostic),
      ),
      templateVersion: selectedTemplate.version,
      output,
    },
    null,
    2,
  ),
);
