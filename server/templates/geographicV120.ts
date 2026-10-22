import type { ReportTemplate, TextElement } from "../../src/types/report";

/** Derive a new edition from the approved v1.1 layout without rewriting it. */
export function geographicV120Template(previous: ReportTemplate): ReportTemplate {
  if (previous.id !== "industrial-market-geographic") throw new Error("Geographic source required");
  const result = structuredClone(previous);
  result.version = "1.2.0";
  const page = result.pages.find(item => item.id === "submarket-overview");
  if (!page) throw new Error("Geographic submarket overview missing");
  page.elements = page.elements.filter(element => element.id !== "featured-heading" && element.id !== "featured-brokerage");
  const element = (id: string) => {
    const found = page.elements.find(item => item.id === id);
    if (!found) throw new Error(`Featured card element missing: ${id}`);
    return found;
  };
  const photo = element("featured-photo");
  if (photo.type !== "image") throw new Error("Featured photograph must be an image");
  photo.binding = { path: "market.featuredCardV120.image", fallback: "" };
  photo.linkBinding = { path: "market.featuredCardV120.listingUrl" };
  const area = element("featured-area") as TextElement;
  area.binding = { path: "market.featuredCardV120.area", fallback: "" };
  area.y = 225 * 4 / 3;
  area.height = 19 * 4 / 3;
  area.width = 240 * 4 / 3;
  area.style.fontSize = 16 * 4 / 3;
  if (area.style.typography) area.style.typography.fontSize = 16 * 4 / 3;
  const address = element("featured-address") as TextElement;
  address.binding = { path: "market.featuredCardV120.address", fallback: "" };
  address.y = 245 * 4 / 3;
  address.height = 13 * 4 / 3;
  address.style.fontSize = 10.5 * 4 / 3;
  if (address.style.typography) address.style.typography.fontSize = 10.5 * 4 / 3;
  const details = element("featured-details") as TextElement;
  details.binding = { path: "market.featuredCardV120.details", fallback: "" };
  details.y = 259 * 4 / 3;
  details.height = 10 * 4 / 3;
  const badge = structuredClone(details);
  badge.id = "featured-status-badge";
  badge.name = "Listing link or availability status";
  badge.text = "";
  badge.binding = { path: "market.featuredCardV120.badge", fallback: "" };
  badge.linkBinding = { path: "market.featuredCardV120.listingUrl" };
  badge.x = 503 * 4 / 3;
  badge.y = 211 * 4 / 3;
  badge.width = 73 * 4 / 3;
  badge.height = 13 * 4 / 3;
  badge.style = { ...badge.style, background: "#762c40", fill: { type: "solid", color: "#762c40" },
    color: "#ffffff", padding: 2 * 4 / 3, fontSize: 7.1 * 4 / 3, fontWeight: 700,
    textAlign: "center", borderRadius: 0,
    typography: badge.style.typography ? { ...badge.style.typography, color: "#ffffff", fontSize: 7.1 * 4 / 3,
      fontWeight: 700, textAlign: "center", verticalAlign: "middle" } : undefined };
  page.elements.push(badge);
  const overallOverview = result.pages.find(item => item.id === "market-overview");
  const overallActivity = result.pages.find(item => item.id === "market-highlights");
  const submarketActivity = result.pages.find(item => item.id === "submarket-highlights");
  if (!overallOverview || !overallActivity || !submarketActivity)
    throw new Error("Overall or submarket geographic page missing");
  const overallBody = (source: typeof page) => source.elements
    .filter(item => item.y >= 110 && item.y < 1020)
    .map(item => {
      const copy = structuredClone(item);
      copy.id = `overall-${copy.id}`;
      if (copy.binding) copy.binding.path = copy.binding.path
        .replace(/^market\.narrative$/, "overallMarket.narrative")
        .replace(/^market\.featuredCardV120/, "overallGeographic.featuredCardV120")
        .replace(/^market\.activityMapAssetUrl$/, "overallGeographic.activityMapAssetUrl")
        .replace(/^market\.activityIndex/, "overallGeographic.activityIndex");
      if (copy.type === "image" && copy.linkBinding) copy.linkBinding.path =
        copy.linkBinding.path.replace(/^market\.featuredCardV120/, "overallGeographic.featuredCardV120");
      if (copy.type === "text" && copy.linkBinding) copy.linkBinding.path =
        copy.linkBinding.path.replace(/^market\.featuredCardV120/, "overallGeographic.featuredCardV120");
      if (copy.type === "table" || copy.type === "chart") copy.sourcePath = copy.sourcePath
        .replace(/^market\.indicatorRows$/, "indicatorRows")
        .replace(/^market\.historicalPeriods$/, "historicalPeriods")
        .replace(/^market\.availabilityBySize$/, "availabilityBySize");
      return copy;
    });
  const overallChrome = (source: typeof page) => source.elements.filter(item => item.y < 110 || item.y >= 1020);
  overallOverview.elements = [...overallChrome(overallOverview), ...overallBody(page)];
  overallActivity.elements = [...overallChrome(overallActivity), ...overallBody(submarketActivity)];
  overallActivity.name = "Overall Market Geographic Activity";
  return result;
}
