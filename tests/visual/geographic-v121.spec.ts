import { expect, test } from "@playwright/test";
import { PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { q2SampleReport } from "../../src/data-providers/sample/q2SampleReport";
import { sampleTemplate } from "../../src/data/sampleTemplate";
import { geographicFamilyTemplate } from "../../server/templates/geographicFamily";
import { geographicV120Template } from "../../server/templates/geographicV120";
import { geographicV121Template } from "../../server/templates/geographicV121";
import { buildPresentationModel } from "../../src/report-engine/bindings/presentationModel";
import { expandTemplatePages } from "../../src/report-engine/generation/repeaters";

const map = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="380" height="582"><rect width="380" height="582" fill="#f2f3f0"/><path d="M30 30L340 70L300 500L50 540Z" fill="#e1e8db" stroke="#762c40"/></svg>')}`;
const fixture = (variant: "listing" | "no-url" | "lease" | "sale" | "empty" | "sale-listing" | "both-listing" = "listing", baseline = false) => {
  const report = structuredClone(q2SampleReport);
  for (const detail of report.submarketDetails) detail.activityMapAssetUrl = map;
  report.overallActivityMapAssetUrl = map;
  const detail = report.submarketDetails[0]!;
  detail.featuredAvailability = {
    status: "selected", source: { kind: "contributor", contributorId: "qa-contributor", availabilityId: "qa-availability",
      propertyId: "qa-property", period: "2026 Q2", submarket: detail.name, rank: 1, runId: "qa-run" },
    property: { ...report.availabilities[0]!, address: "2400 Internationale Pkwy, Woodridge, IL", sizeSf: 265062 },
    minimumDivisibleSf: 100000, marketedMaximumSf: 265062, marketingType: variant === "sale-listing" ? "For Sale" : variant === "both-listing" ? "For Sale & Lease" : "For Lease",
    ...((variant === "listing" || variant === "both-listing") ? { listingUrl: "https://example.com/listing" } : {}),
  };
  if (variant === "both-listing") {
    detail.featuredAvailability.property.address = "12345 North International Industrial Parkway, Woodridge, IL";
    detail.featuredAvailability.property.sizeSf = 999000000;
    detail.featuredAvailability.minimumDivisibleSf = 100000000;
    detail.featuredAvailability.marketedMaximumSf = 999000000;
  }
  if (variant === "lease" || variant === "sale" || variant === "empty") {
    detail.featuredAvailability = { status: "empty", reason: "No qualifying Lee listing" };
    if (variant !== "empty") detail.featuredDeal = { status: "selected", kind: variant,
      source: { contributorId: `qa-${variant}`, transactionId: `qa-${variant}-record`, propertyId: "qa-property",
        period: "2026 Q2", submarket: detail.name, rank: 1, runId: "qa-run", selectionBasis: "Verified Lee transaction" },
      property: { address: "2400 Internationale Pkwy, Woodridge, IL", sizeSf: variant === "lease" ? 125000 : 150000, image: "" } };
  }
  report.overallFeaturedAvailability = structuredClone(detail.featuredAvailability);
  report.overallFeaturedDeal = detail.featuredDeal ? structuredClone(detail.featuredDeal) : undefined;
  const data = buildPresentationModel(report);
  const template = baseline ? geographicFamilyTemplate(sampleTemplate) : geographicV121Template(geographicV120Template(geographicFamilyTemplate(sampleTemplate)));
  return { template: { ...template, pages: expandTemplatePages(template, data) }, data, title: "Geographic v1.2.1 QA" };
};

test("Geographic v1.2.1 renders 44 pages, the new hierarchy, real links, and the executive map", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/render-jobs/geographic-v110-baseline", route => route.fulfill({ json: fixture("listing", true) }));
  await page.goto("/?printJob=geographic-v110-baseline");
  await expect(page.locator('[data-render-ready="true"]')).toBeVisible();
  await page.locator("section.print-page").filter({ has: page.getByTestId("featured-photo") }).first()
    .screenshot({ path: testInfo.outputPath("before-listing-card.png") });
  await page.locator('section.print-page[data-page-id="market-highlights"]')
    .screenshot({ path: testInfo.outputPath("before-overall-market.png") });
  await page.route("**/api/render-jobs/geographic-v121-qa", route => route.fulfill({ json: fixture() }));
  await page.goto("/?printJob=geographic-v121-qa");
  await expect(page.locator('[data-render-ready="true"]')).toBeVisible();
  await expect(page.locator("section.print-page")).toHaveCount(44);
  const firstSubmarket = page.locator("section.print-page").filter({ has: page.getByTestId("featured-photo") }).first();
  await expect(firstSubmarket.getByTestId("featured-heading")).toHaveCount(0);
  await expect(firstSubmarket).toContainText("100,000–265,062 SF");
  await expect(firstSubmarket).toContainText("VIEW LISTING");
  await expect(firstSubmarket.getByTestId("featured-status-badge")).toContainText("AVAILABLE FOR LEASE");
  await expect(firstSubmarket.getByTestId("featured-listing-arrow")).toBeVisible();
  await expect(firstSubmarket.getByTestId("featured-details")).toHaveText("Woodridge, IL");
  await expect(firstSubmarket.locator('a[href="https://example.com/listing"]')).toHaveCount(2);
  const overall = page.locator('section.print-page[data-page-id="market-highlights"]');
  await expect(overall.getByTestId("overall-geographic-activity-map")).toBeVisible();
  await firstSubmarket.screenshot({ path: testInfo.outputPath("active-listing-range.png") });
  await overall.screenshot({ path: testInfo.outputPath("overall-market-geographic.png") });
  const pdfBytes = await page.pdf({ path: testInfo.outputPath("geographic-v121.pdf"), format: "Letter", printBackground: true });
  const pdf = await PDFDocument.load(pdfBytes);
  expect(pdf.getPageCount()).toBe(44);
  const listingLinks = pdf.getPages().flatMap(pdfPage => pdfPage.node.Annots()?.asArray().flatMap(ref => {
    const action = pdf.context.lookup(ref, PDFDict).lookupMaybe(PDFName.of("A"), PDFDict);
    const uri = action?.lookupMaybe(PDFName.of("URI"), PDFString);
    return uri?.decodeText() === "https://example.com/listing" ? [uri.decodeText()] : [];
  }) ?? []);
  expect(listingLinks).toHaveLength(4);
  expect(errors).toEqual([]);
});

test("Geographic v1.2.1 handles missing URLs, Lee lease and sale fallbacks, and an intentional empty state", async ({ page }, testInfo) => {
  for (const variant of ["no-url", "lease", "sale", "empty", "sale-listing", "both-listing"] as const) {
    await page.route(`**/api/render-jobs/geographic-v121-${variant}`, route => route.fulfill({ json: fixture(variant) }));
    await page.goto(`/?printJob=geographic-v121-${variant}`);
    await expect(page.locator('[data-render-ready="true"]')).toBeVisible();
    const cardPage = page.locator("section.print-page").filter({ has: page.getByTestId("featured-photo") }).first();
    const expected = { "no-url": "AVAILABLE FOR LEASE", lease: "LEASED", sale: "SOLD", empty: "Market research", "sale-listing": "AVAILABLE FOR SALE", "both-listing": "AVAILABLE FOR SALE & LEASE" }[variant];
    await expect(cardPage).toContainText(expected);
    await expect(cardPage.locator('a[href^="https://example.com/listing"]')).toHaveCount(variant === "both-listing" ? 2 : 0);
    await expect(cardPage.getByTestId("featured-listing-arrow")).toHaveCount(variant === "both-listing" ? 1 : 0);
    if (variant === "both-listing") await expect(cardPage).toContainText("100,000,000–999,000,000 SF");
    if (variant === "lease" || variant === "sale") await expect(cardPage).toContainText("Property image unavailable");
    await cardPage.screenshot({ path: testInfo.outputPath(`${variant}-card.png`) });
  }
});
