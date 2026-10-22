import { expect, it } from "vitest";
import { sampleTemplate } from "../../data/sampleTemplate";
import { q2SampleReport } from "../../data-providers/sample/q2SampleReport";
import { geographicFamilyTemplate } from "../../../server/templates/geographicFamily";
import { expandTemplatePages } from "../generation/repeaters";
import { buildPresentationModel } from "../bindings/presentationModel";

it.each([0, 1, 3])("keeps %i entries per category in the sidebar and hides unused badges", count => {
  const data = buildPresentationModel(q2SampleReport);
  for (const detail of data.submarketDetails) {
    detail.activityIndex.forEach(section => {
      section.entries = Array.from({ length: count }, (_, index) => ({ code: `L${index + 1}`, address: "Street",
        metadata: "City | 25,000 SF", party: "Party", label: "Street" }));
      section.emptyMessage = count ? "" : "No qualifying activity this quarter";
    });
  }
  const pages = expandTemplatePages(geographicFamilyTemplate(sampleTemplate), data);
  const maps = pages.filter(page => page.elements.some(element => element.id === "geographic-activity-map"));
  expect(maps.length).toBeGreaterThan(0);
  for (const page of maps) {
    const sidebar = page.elements.filter(element => element.id.startsWith("activity-") && !element.hidden);
    expect(sidebar.filter(element => element.id.endsWith("-circle"))).toHaveLength(count * 5);
    for (const element of sidebar) expect(element.y + element.height).toBeLessThanOrEqual(700 * 4 / 3 + 0.01);
    const body = sidebar.find(element => element.id.endsWith("-metadata"));
    if (body) expect(body.style.typography?.color).toBe("#626e77");
  }
});
