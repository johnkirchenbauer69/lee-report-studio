import type { ReportElement, ReportTemplate, TextElement } from "../../src/types/report";
import { CANONICAL_TEMPLATES } from "../../src/report-engine/canonicalTemplates";
import { ACTIVITY_SECTIONS } from "../../src/report-engine/geographic/activity";

/** Approved InDesign point geometry converted to the editor's 96 dpi coordinates. */
export function geographicFamilyTemplate(classic: ReportTemplate): ReportTemplate {
  const result = structuredClone(classic);
  Object.assign(result, { id: CANONICAL_TEMPLATES[1].id, name: CANONICAL_TEMPLATES[1].name, version: "1.0.0" });
  const overview = result.pages.find(page => page.id === "submarket-overview");
  const activity = result.pages.find(page => page.id === "submarket-highlights");
  if (!overview || !activity) throw new Error("Approved submarket page definitions are missing.");
  const originalElements = structuredClone([...overview.elements, ...activity.elements]);
  const find = (id: string) => {
    const element = originalElements.find(item => item.id === id);
    if (!element) throw new Error(`Approved layout element missing: ${id}`);
    return structuredClone(element);
  };
  const place = (element: ReportElement, x: number, y: number, width: number, height: number) =>
    Object.assign(element, { x: x * 4 / 3, y: y * 4 / 3, width: width * 4 / 3, height: height * 4 / 3 });
  const title = find("detail-overview-title") as TextElement;
  function text(id: string, content: string, x: number, y: number, w: number, h: number, size: number, color: string, binding?: string): TextElement {
    const fontWeight = size <= 8.2 ? 400 : 700;
    return { ...place(structuredClone(title), x, y, w, h), type: "text", id, name: id, text: content,
      binding: binding ? { path: binding, fallback: "" } : undefined,
      style: { ...title.style, shadow: undefined, bevel: undefined, fontSize: size * 4 / 3, fontWeight,
        fontAssetId: undefined, fontChecksum: undefined, color, textAlign: "left", padding: 0, lineHeight: 1.2,
        typography: { ...title.style.typography!, fontSize: size * 4 / 3, fontWeight, fontAssetId: undefined,
          fontChecksum: undefined, color, textAlign: "left", lineHeight: 1.2 } } };
  }
  const availability = place(find("detail-availability-chart"), 16, 578, 284.25, 174.73828125);
  const construction = place(find("detail-construction-chart"), 312, 578, 284.25, 174.73828125);
  const remove = new Set(["detail-market-map", "detail-top-leases-table", "detail-top-sales-table", "text-af74266a", "text-8d65015e", "shape-ee10ff00", "shape-495db431"]);
  overview.elements = overview.elements.filter(item => !remove.has(item.id));
  for (const element of overview.elements) {
    if (element.id === "detail-chart-net") place(element, 16, 387.71484375, 284.25, 174.73828125);
    if (element.id === "detail-chart-sales-unavailable") place(element, 312, 387.71484375, 284.25, 174.73828125);
    if (element.id === "detail-chart-1-title") place(element, 24, 375, 276, 17.25);
    if (element.id === "detail-chart-2-title") place(element, 320, 375, 276, 17.25);
  }
  overview.elements.push(availability, construction,
    text("geo-availability-chart-title", "AVAILABILITY BY SIZE RANGE", 24, 564, 276, 14, 9, "#762c40"),
    text("geo-construction-chart-title", "UNDER CONSTRUCTION & DELIVERIES", 320, 564, 276, 14, 9, "#762c40"),
    text("featured-heading", "LEE FEATURED AVAILABILITY", 324, 91.5, 264, 19.5, 12.75, "#0099d8"),
    { ...place(find("detail-market-map"), 324, 110, 264, 96), type: "image", id: "featured-photo", name: "Featured property photograph", src: "", fit: "cover", binding: { path: "market.featuredCard.image" }, linkBinding: { path: "market.featuredCard.listingUrl" }, publicationRequired: false },
    { ...place(find("detail-header-3"), 324, 206, 264, 66), id: "featured-panel", name: "Featured navy panel", style: { background: "#003146", fill: { type: "solid", color: "#003146" } } },
    text("featured-address", "", 336, 214, 240, 14, 10.6, "#ffffff", "market.featuredCard.address"),
    text("featured-area", "", 336, 230, 240, 16, 12.6, "#ffffff", "market.featuredCard.area"),
    text("featured-details", "", 336, 247, 240, 11, 8, "#d2dce1", "market.featuredCard.details"),
    text("featured-brokerage", "", 336, 258, 240, 11, 7.8, "#d2dce1", "market.featuredCard.brokerage"),
  );
  const chrome = new Set(["detail-header-4", "detail-period-4", "detail-market-4", "detail-footer-4", "detail-page-4", "text-94b8d453", "text-8911ecd2", "image-f68bff67"]);
  activity.elements = activity.elements.filter(item => chrome.has(item.id));
  activity.name = "{item} Geographic Market Activity";
  activity.elements.push(text("map-title", "GEOGRAPHIC MARKET ACTIVITY", 28, 91.5, 380, 19.5, 12.75, "#0099d8"),
    { ...place(find("detail-market-map"), 28, 118, 380, 582), type: "image", id: "geographic-activity-map", name: "Vector activity map", src: "", fit: "contain", binding: { path: "market.activityMapAssetUrl" }, publicationRequired: true });
  ACTIVITY_SECTIONS.forEach((section, index) => {
    const y = 118 + index * 116;
    activity.elements.push(text(`activity-${section.code}-heading`, section.title.toUpperCase(), 426, y, 162, 14, 9.6, "#762c40"));
    for (let row = 0; row < 3; row++) {
      const path = `market.activityIndex.${index}.entries.${row}`;
      const id = `activity-${section.code}${row + 1}`;
      activity.elements.push(
        { id: `${id}-circle`, name: `${id} badge`, type: "shape", shape: "circle", x: 426 * 4 / 3, y: y * 4 / 3,
          width: 12.4 * 4 / 3, height: 12.4 * 4 / 3, style: { background: section.color, fill: { type: "solid", color: section.color } } },
        text(`${id}-code`, "", 426, y, 12.4, 12.4, 7.2, "#ffffff", `${path}.code`),
        text(`${id}-address`, "", 444, y, 144, 11, 8.6, "#003146", `${path}.address`),
        text(`${id}-metadata`, "", 444, y + 11, 144, 10, 8.2, "#626e77", `${path}.metadata`),
        text(`${id}-party`, "", 444, y + 21, 144, 10, 8.2, "#626e77", `${path}.party`),
      );
    }
    activity.elements.push(text(`activity-${section.code}-empty`, "", 426, y + 18, 162, 28, 8.2, "#626e77", `market.activityIndex.${index}.emptyMessage`));
  });
  activity.elements.push(text("map-attribution", "Map context: U.S. Census Bureau • Reporting boundaries: Lee & Associates", 28, 704, 380, 12, 6.2, "#626e77"));
  for (const page of result.pages) for (const element of page.elements) {
    element.style.shadow = undefined; element.style.bevel = undefined;
    if (element.type === "chart") element.chartStyle = { ...element.chartStyle, shadow: false };
    if (element.type === "text" && /^activity-.*-code$/.test(element.id)) {
      element.style.textAlign = "center";
      element.style.typography!.textAlign = "center";
      element.style.typography!.verticalAlign = "middle";
    }
    if (element.id === "geographic-activity-map" || element.id === "featured-photo") {
      element.style.borderRadius = 0;
      element.style.cornerRadii = undefined;
    }
  }
  return result;
}
