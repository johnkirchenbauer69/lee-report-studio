import fs from "node:fs/promises";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
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
const presentedPropertySlots = [
  ...presentation.topAvailabilities,
  ...presentation.topDeliveries,
  ...presentation.topConstruction,
  ...presentation.submarketDetails.flatMap((detail) => [
    ...detail.topAvailabilities,
    ...detail.topDeliveries,
    ...detail.topConstruction,
  ]),
];
const propertyCardStates = {
  populatedPropertyCards: presentedPropertySlots.filter(
    (slot) => slot.state !== "none",
  ).length,
  resolvedPropertyImages: presentedPropertySlots.filter(
    (slot) => slot.state === "record",
  ).length,
  actualImageFailures: presentedPropertySlots.filter(
    (slot) => slot.state === "image-unavailable",
  ).length,
  emptyRankSlots: presentedPropertySlots.filter((slot) => slot.state === "none")
    .length,
};
if (
  JSON.stringify(propertyCardStates) !==
  JSON.stringify({
    populatedPropertyCards: 100,
    resolvedPropertyImages: 100,
    actualImageFailures: 0,
    emptyRankSlots: 71,
  })
)
  throw new Error(
    `Unexpected Q3 property-card states: ${JSON.stringify(propertyCardStates)}.`,
  );
if (presentation.topDeliveries[2]?.state !== "none")
  throw new Error(
    "The empty Overall Market delivery rank must be None to Report.",
  );
const westCook = presentation.submarketDetails.find(
  (detail) => detail.displayName === "West Cook",
);
const oversizedWestCook = westCook?.topConstruction.find((slot) =>
  slot.address.startsWith("840 25th Ave"),
);
if (
  oversizedWestCook?.state !== "record" ||
  !oversizedWestCook.image.startsWith("/api/assets/") ||
  !oversizedWestCook.detail
)
  throw new Error(
    "The populated West Cook oversized-image card did not resolve from an immutable normalized derivative.",
  );
const normalizedAssetId = oversizedWestCook.image.split("/")[3];
const refreshedAssetsResponse = await fetch(`${api}/api/assets`);
if (!refreshedAssetsResponse.ok)
  throw new Error("Normalized image asset metadata could not be loaded.");
const refreshedAssets = (
  (await refreshedAssetsResponse.json()) as { assets: Asset[] }
).assets;
const normalizedWestCookAsset = refreshedAssets.find(
  (asset) => asset.id === normalizedAssetId,
);
if (
  normalizedWestCookAsset?.derivative?.kind !==
    "normalized-salesforce-report-image" ||
  normalizedWestCookAsset.derivative.sourceSize <= 15 * 1024 * 1024 ||
  normalizedWestCookAsset.derivative.outputSize > 3 * 1024 * 1024
)
  throw new Error(
    "The West Cook image asset did not retain bounded derivative provenance.",
  );
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
const submarketMaps = renderedMaps.filter((element) =>
  element.id.startsWith("detail-market-map"),
);
if (
  submarketMaps.length !== 18 ||
  submarketMaps.some(
    (element) =>
      element.type !== "image" ||
      !element.src.includes("/normalized/") ||
      Boolean(element.edgeInset),
  )
)
  throw new Error(
    "All 18 submarket maps must use normalized derivatives without render insets.",
  );
if (
  publishedPages
    .flatMap((page) => page.elements)
    .some(
      (element) =>
        element.type === "image" &&
        element.id.includes("-image-") &&
        !element.id.includes("market-map") &&
        element.edgeInset,
    )
)
  throw new Error("Map edge normalization leaked into a property image.");
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

const detailNavigationRows = presentation.submarketTableRows.filter(
  (row) => row.kind === "detail",
);
if (
  detailNavigationRows.length !== 18 ||
  detailNavigationRows.some((row) => {
    const matches = publishedPages.filter(
      (page) =>
        page.geographyId === row.geographyId && page.pageKind === "overview",
    );
    return matches.length !== 1 || !matches[0]?.anchor;
  })
)
  throw new Error(
    "Every Q3 submarket table row must resolve to one stable Overview-page anchor.",
  );
const indicatorRows = [
  ...presentation.indicatorRows,
  ...presentation.submarketDetails.flatMap((detail) => detail.indicatorRows),
];
const governedIndicatorColors = {
  favorable: "#8A941E",
  unfavorable: "#CD1442",
  neutral: "#4E131E",
} as const;
if (
  indicatorRows.some(
    (row) =>
      !["up", "down", "equal"].includes(row.direction) ||
      !["favorable", "unfavorable", "neutral"].includes(row.semanticStatus) ||
      row.indicatorColor !== governedIndicatorColors[row.semanticStatus] ||
      (row.semanticStatus === "neutral"
        ? row.indicatorKind !== "bar" || row.indicatorGlyph !== ""
        : row.indicatorKind !== "arrow"),
  )
)
  throw new Error(
    "A Q3 market indicator is missing semantic direction styling.",
  );
if (
  indicatorRows
    .filter((row) => row.metricKey === "underConstructionSf")
    .some(
      (row) =>
        row.semanticStatus !== "neutral" ||
        row.indicatorKind !== "bar" ||
        row.indicatorColor !== "#4E131E",
    )
)
  throw new Error("Under Construction must remain semantically neutral.");

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
const pdfAnnotations = pdf
  .getPage(1)
  .node.lookupMaybe(PDFName.of("Annots"), PDFArray);
if (pdfAnnotations?.size() !== 18)
  throw new Error(
    `Expected 18 internal links on PDF page 2; received ${pdfAnnotations?.size() ?? 0}.`,
  );
const pdfDestinations = Array.from(
  { length: pdfAnnotations.size() },
  (_, index) => {
    const annotation = pdf.context.lookup(pdfAnnotations.get(index), PDFDict);
    const direct = annotation.get(PDFName.of("Dest"));
    const action = annotation.lookupMaybe(PDFName.of("A"), PDFDict);
    const destination = direct ?? action?.get(PDFName.of("D"));
    return destination instanceof PDFArray
      ? destination.get(0).toString()
      : destination?.toString();
  },
);
for (const anchor of ["ohare-overview", "west-cook-overview"])
  if (!pdfDestinations.includes(`/${anchor}`))
    throw new Error(`PDF internal destination ${anchor} is unavailable.`);
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
        overall: renderedMaps.length - submarketMaps.length,
        submarkets: submarketMaps.length,
        normalizedDerivative: true,
      },
      contributorImages: {
        totalSlots: reportScopes.length * 9,
        ...propertyCardStates,
        westCookNormalizedDerivative: normalizedWestCookAsset.derivative,
      },
      marketIndicators: {
        semanticRows: indicatorRows.length,
        currentVersusImmediatelyPrior: true,
        underConstructionNeutral: true,
        colors: governedIndicatorColors,
        neutralIndicator: "bar",
      },
      navigation: {
        browserTargets: detailNavigationRows.length,
        pdfLinkAnnotations: pdfAnnotations.size(),
        stableNamedDestinations: true,
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
