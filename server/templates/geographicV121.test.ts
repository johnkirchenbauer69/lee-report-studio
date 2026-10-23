import { expect, it } from "vitest";
import { sampleTemplate } from "../../src/data/sampleTemplate";
import { geographicFamilyTemplate } from "./geographicFamily";
import { geographicV120Template } from "./geographicV120";
import { geographicV121Template } from "./geographicV121";
import { q2SampleReport } from "../../src/data-providers/sample/q2SampleReport";
import { buildPresentationModel } from "../../src/report-engine/bindings/presentationModel";
import { expandTemplatePages } from "../../src/report-engine/generation/repeaters";

it("preserves the published edition and all geometry outside card text", () => {
  const source = geographicV120Template(geographicFamilyTemplate(sampleTemplate));
  const before = structuredClone(source);
  const next = geographicV121Template(source);
  expect(source).toEqual(before);
  expect(next.version).toBe("1.2.1");
  expect(expandTemplatePages(next, buildPresentationModel(q2SampleReport))).toHaveLength(44);
  for (const page of next.pages) {
    const old = source.pages.find(p => p.id === page.id)!;
    for (const element of old.elements.filter(e => !e.id.includes("featured-")))
      expect(page.elements.find(e => e.id === element.id)).toEqual(element);
    for (const element of old.elements.filter(e => /featured-(photo|panel)$/.test(e.id))) {
      const updated = page.elements.find(e => e.id === element.id)!;
      expect([updated.x, updated.y, updated.width, updated.height]).toEqual([element.x, element.y, element.width, element.height]);
    }
  }
  const card = next.pages.find(p => p.id === "submarket-overview")!;
  const status = card.elements.find(e => e.id === "featured-status-badge")!;
  const area = card.elements.find(e => e.id === "featured-area")!;
  expect(status.x).toBe(area.x);
  expect(status).toMatchObject({ binding: { path: "market.featuredCardV121.status" }, linkBinding: undefined });
  expect(card.elements.find(e => e.id === "featured-status-badge-background")?.style.fill).toEqual({ type: "solid", color: "#762c40" });
  expect(card.elements.find(e => e.id === "featured-listing-cta")).toMatchObject({ linkBinding: { path: "market.featuredCardV121.listingUrl" } });
});

it("keeps short status chips compact and their native backgrounds aligned", () => {
  const template = geographicV121Template(geographicV120Template(geographicFamilyTemplate(sampleTemplate)));
  const data = buildPresentationModel(q2SampleReport);
  data.submarketDetails[0]!.featuredCardV121.status = "SOLD";
  const page = expandTemplatePages(template, data).find(p => p.id.startsWith("submarket-overview-repeat"))!;
  const chip = page.elements.find(e => e.id === "featured-status-badge")!;
  const background = page.elements.find(e => e.id === "featured-status-badge-background")!;
  expect(chip.width).toBeLessThanOrEqual(40 * 4 / 3);
  expect(background.width).toBe(chip.width);
});
