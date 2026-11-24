import type { ReportElement } from "../../types/report";

const matchingTitle: Record<string, string> = {
  "geo-availability-chart-title": "detail-chart-1-title",
  "geo-construction-chart-title": "detail-chart-2-title",
};

/** Update legacy Geographic defaults while preserving custom title formatting. */
export function matchGeographicChartTitle(
  element: ReportElement,
  siblings: readonly ReportElement[],
): ReportElement {
  if (element.type !== "text") return element;
  const prefix = element.id.startsWith("overall-") ? "overall-" : "";
  const match = matchingTitle[element.id.slice(prefix.length)];
  if (!match) return element;
  const { typography } = element.style;
  if ((typography?.color ?? element.style.color) !== "#762c40" ||
      (typography?.textAlign ?? element.style.textAlign) !== "left" ||
      (typography?.fontSize ?? element.style.fontSize) !== 12) return element;
  const reference = siblings.find(item => item.id === prefix + match);
  if (reference?.type !== "text") return element;
  return { ...element, style: structuredClone(reference.style) };
}
