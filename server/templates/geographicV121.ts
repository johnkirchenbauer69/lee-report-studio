import type { ReportTemplate, TextElement, ShapeElement } from "../../src/types/report";

/** A separate edition: retain all geometry outside the existing card text panel. */
export function geographicV121Template(previous: ReportTemplate): ReportTemplate {
  if (previous.id !== "industrial-market-geographic" || previous.version !== "1.2.0")
    throw new Error("Geographic v1.2.0 source required");
  const result = structuredClone(previous);
  result.version = "1.2.1";
  for (const page of result.pages) {
    const prefix = page.id === "market-overview" ? "overall-" : page.id === "submarket-overview" ? "" : undefined;
    if (prefix === undefined) continue;
    for (const element of page.elements) {
      if (element.binding) element.binding.path = element.binding.path.replace("featuredCardV120", "featuredCardV121");
      if ((element.type === "text" || element.type === "image") && element.linkBinding)
        element.linkBinding.path = element.linkBinding.path.replace("featuredCardV120", "featuredCardV121");
    }
    const status = page.elements.find(e => e.id === `${prefix}featured-status-badge`) as TextElement;
    const area = page.elements.find(e => e.id === `${prefix}featured-area`) as TextElement;
    if (!status || !area) throw new Error("Featured card missing");
    const cta = structuredClone(status);
    cta.id = `${prefix}featured-listing-cta`;
    cta.name = "Verified listing link";
    cta.binding!.path = cta.binding!.path.replace(/\.badge$/, ".ctaText");
    status.name = "Property status";
    status.binding!.path = status.binding!.path.replace(/\.badge$/, ".status");
    status.linkBinding = undefined;
    status.x = area.x;
    status.width = 159 * 4 / 3;
    status.height = 12 * 4 / 3;
    status.style.textAlign = "left";
    status.style.padding = 2 * 4 / 3;
    if (status.style.typography) status.style.typography.textAlign = "left";
    const panel = page.elements.find(e => e.id === `${prefix}featured-panel`)!;
    for (const text of [status, cta]) {
      // Use the pinned bold face, not a browser-synthesized bold regular face.
      text.style.fontAssetId = area.style.fontAssetId;
      text.style.fontChecksum = area.style.fontChecksum;
      if (text.style.typography && area.style.typography) {
        text.style.typography.fontAssetId = area.style.typography.fontAssetId;
        text.style.typography.fontChecksum = area.style.typography.fontChecksum;
      }
      const background = { ...structuredClone(panel), id: `${text.id}-background`, name: `${text.name} background`,
        x: text.x, y: text.y, width: text.width, height: text.height, binding: structuredClone(text.binding),
        style: { background: "#762c40", fill: { type: "solid" as const, color: "#762c40" } } };
      page.elements.splice(page.elements.indexOf(status), 0, background);
      text.style.background = "transparent";
      text.style.fill = { type: "solid", color: "transparent" };
    }
    // The approved Nunito face lacks U+2197 in native InDesign. Keep the arrow
    // as editable vector artwork beneath the full-width transparent CTA link.
    const arrow: ShapeElement = { id: `${prefix}featured-listing-arrow`, name: "Listing northeast arrow", type: "shape", shape: "path",
      x: 568 * 4 / 3, y: 215 * 4 / 3, width: 4.5 * 4 / 3, height: 4.5 * 4 / 3, rotation: 0,
      binding: structuredClone(cta.binding), style: { fill: { type: "solid", color: "#ffffff" }, background: "#ffffff" },
      pathGeometry: { rings: [[[0, .85], [.65, .2], [.3, .2], [.3, 0], [1, 0], [1, .7], [.8, .7], [.8, .35], [.15, 1]]
        .map(([x, y]) => ({ x: x!, y: y! }))] } };
    page.elements.push(arrow, cta);
  }
  return result;
}
