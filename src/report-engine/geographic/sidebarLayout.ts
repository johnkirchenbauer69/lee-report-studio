import type { ReportPage } from "../../types/report";
import { getByContextPath } from "../../engine/bindings";
import { ACTIVITY_SECTIONS } from "./activity";

/** Reserve the same print area for sparse and maximum-density editions. */
export function layoutActivitySidebar(page: ReportPage, data: unknown) {
  const overall = page.elements.some(element => element.id === "overall-geographic-activity-map");
  if (!overall && !page.elements.some(element => element.id === "geographic-activity-map")) return page;
  const prefix = overall ? "overall-" : "";
  const sections = getByContextPath(data, overall ? "overallGeographic.activityIndex" : "market.activityIndex", page.bindingContext) as { entries: { party?: string }[] }[];
  if (!Array.isArray(sections) || sections.length !== 5) throw new Error("Geographic sidebar data unavailable");
  const counts = sections.map(section => Math.min(section.entries.length, 3));
  const plans = sections.map(section => section.entries.slice(0, 3).map(entry => ({ wrap: (entry.party?.length ?? 0) > 32 })));
  const rows = counts.reduce((sum, count) => sum + count, 0);
  const minimum = plans.reduce((sum, plan) => sum + (plan.length ? plan.reduce((subtotal, row) => subtotal + (row.wrap ? 41 : 31), 0) : 20), 0);
  const available = 582 - 5 * 20 - 4 * 3;
  if (minimum > available) throw new Error("Activity sidebar cannot fit all party names legibly; editorial adjustment is required.");
  const extra = rows ? Math.min(8.5, (available - minimum) / rows) : 0;
  let top = 118;
  const result = structuredClone(page);
  ACTIVITY_SECTIONS.forEach((section, index) => {
    const count = counts[index]!;
    for (const element of result.elements) {
      if (element.id === `${prefix}activity-${section.code}-heading`) element.y = top * 4 / 3;
      if (element.id === `${prefix}activity-${section.code}-empty`) {
        element.y = (top + 20) * 4 / 3; element.hidden = count > 0;
      }
      const match = element.id.match(new RegExp(`^${prefix}activity-${section.code}([123])-(address|metadata|party|circle|code)$`));
      if (!match) continue;
      const row = Number(match[1]) - 1, role = match[2];
      element.hidden = row >= count;
      const offset = role === "metadata" ? 10.5 : role === "party" ? 20.5 : role === "circle" ? 1 : 0;
      const before = plans[index]!.slice(0, row).reduce((sum, prior) => sum + (prior.wrap ? 41 : 31) + extra, 0);
      element.y = (top + 20 + before + offset) * 4 / 3;
      if (role === "party") element.height = (plans[index]![row]?.wrap ? 20 : 10) * 4 / 3;
    }
    top += 20 + (count ? plans[index]!.reduce((sum, row) => sum + (row.wrap ? 41 : 31) + extra, 0) : 20) + 3;
  });
  return result;
}
