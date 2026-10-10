import type { ReportPage } from "../types/report";
import type { IndustrialMarketReport } from "../report-engine/schema/industrialMarketReport";
import { CHICAGO_SUBMARKETS } from "../report-engine/submarkets";

export function fitPageZoom(width: number, height: number, pageWidth: number, pageHeight: number, mode: "page" | "width" = "page") {
  const availableWidth = Math.max(1, width - 80), availableHeight = Math.max(1, height - 100);
  return Math.max(0.05, Math.min(2, mode === "width" ? availableWidth / pageWidth : Math.min(availableWidth / pageWidth, availableHeight / pageHeight)));
}
export function pageSection(page: ReportPage, _report?: IndustrialMarketReport): string {
  if (page.geographyId) {
    if (page.geographyId === "overall-market") return "Overall Market";
    return CHICAGO_SUBMARKETS.find(m => m.id === page.geographyId)?.displayName ?? page.geographyId;
  }
  if (page.repeat) return "Submarket layout";
  if (page.elements.some(e => e.type === "text" && e.closingContent) || /methodology|definitions|contacts|who we are/i.test(page.name)) return "Closing Pages";
  return page.name.toLowerCase().includes("cover") ? "Cover" : "Overall Market";
}
