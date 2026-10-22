import { expect, it } from "vitest";
import { sampleTemplate } from "../../src/data/sampleTemplate";
import { geographicFamilyTemplate } from "./geographicFamily";
import { geographicV120Template } from "./geographicV120";
import { q2SampleReport } from "../../src/data-providers/sample/q2SampleReport";
import { buildPresentationModel } from "../../src/report-engine/bindings/presentationModel";
import { expandTemplatePages } from "../../src/report-engine/generation/repeaters";

it("derives an independent v1.2 edition while keeping the approved card frame and Classic source", () => {
  const classic = structuredClone(sampleTemplate);
  const previous = geographicFamilyTemplate(sampleTemplate);
  const before = structuredClone(previous);
  const next = geographicV120Template(previous);
  expect(next.version).toBe("1.2.0");
  expect(previous).toEqual(before);
  expect(sampleTemplate).toEqual(classic);
  const oldPage = previous.pages.find(page => page.id === "submarket-overview")!;
  const page = next.pages.find(page => page.id === "submarket-overview")!;
  expect(page.elements.some(element => element.id === "featured-heading")).toBe(false);
  for (const id of ["featured-photo", "featured-panel"]) {
    const old = oldPage.elements.find(element => element.id === id)!;
    const updated = page.elements.find(element => element.id === id)!;
    expect([updated.x, updated.y, updated.width, updated.height]).toEqual([old.x, old.y, old.width, old.height]);
  }
  expect(page.elements.find(element => element.id === "featured-status-badge")).toMatchObject({
    binding: { path: "market.featuredCardV120.badge" },
    linkBinding: { path: "market.featuredCardV120.listingUrl" },
  });
});

it("fills the two existing Overall Market pages with geographic content and retains 44 pages", () => {
  const template = geographicV120Template(geographicFamilyTemplate(sampleTemplate));
  const pages = expandTemplatePages(template, buildPresentationModel(q2SampleReport));
  expect(pages).toHaveLength(44);
  const overview = pages.find(page => page.id === "market-overview")!;
  const activity = pages.find(page => page.id === "market-highlights")!;
  expect(overview.elements.find(element => element.id === "overall-featured-photo")?.binding?.path)
    .toBe("overallGeographic.featuredCardV120.image");
  expect(activity.elements.find(element => element.id === "overall-geographic-activity-map")?.binding?.path)
    .toBe("overallGeographic.activityMapAssetUrl");
  expect(activity.elements.filter(element => element.id.startsWith("overall-activity-") && element.id.endsWith("-heading")))
    .toHaveLength(5);
  expect(activity.elements.filter(element => /^overall-activity-L[123]-circle$/.test(element.id) && !element.hidden))
    .toHaveLength(Math.min(3, q2SampleReport.leasing.length));
  expect(overview.elements.filter(element => element.type === "chart")).toHaveLength(4);
  expect(overview.elements.find(element => element.id === "overall-featured-status-badge")?.hidden).toBe(true);
});

it("keeps long streets and large SF ranges inside the original navy panel", () => {
  const data = buildPresentationModel(q2SampleReport);
  const detail = data.submarketDetails[0]!;
  detail.featuredCardV120.address = "12345 North Very Long International Industrial Parkway";
  detail.featuredCardV120.area = "100,000,000–999,000,000 SF";
  const pages = expandTemplatePages(geographicV120Template(geographicFamilyTemplate(sampleTemplate)), data);
  const page = pages.find(item => item.id.startsWith("submarket-overview-repeat"))!;
  const address = page.elements.find(item => item.id === "featured-address")!;
  const details = page.elements.find(item => item.id === "featured-details")!;
  const area = page.elements.find(item => item.id === "featured-area")!;
  const panel = page.elements.find(item => item.id === "featured-panel")!;
  expect(address.y + address.height).toBeLessThanOrEqual(details.y);
  expect(details.y + details.height).toBeLessThanOrEqual(panel.y + panel.height);
  expect(area.style.fontSize).toBeGreaterThan(address.style.fontSize!);
  expect(area.x + area.width).toBeLessThanOrEqual(panel.x + panel.width);
});
