import {
  formatValue,
  getByContextPath,
  getByPath,
} from "../../engine/bindings";
import type {
  ReportElement,
  ReportPage,
  ReportTemplate,
  TextElement,
} from "../../types/report";
import type { ReportProviderId } from "../schema/generation";
import type {
  DatasetSection,
  IndustrialMarketReport,
} from "../schema/industrialMarketReport";

const sectionLabel = (section: DatasetSection) =>
  section.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

const unavailablePlaceholder = (element: ReportElement): TextElement => ({
  id: `${element.id}-data-unavailable`,
  type: "text",
  name: "Data unavailable",
  x: element.x,
  y: element.y,
  width: element.width,
  height: element.height,
  locked: true,
  text:
    element.unavailableMessage ??
    `Data unavailable: ${sectionLabel(element.requiredDataSection!)}`,
  style: {
    background: "#f2f5f6",
    borderColor: "#c8d2d7",
    borderWidth: 1,
    color: "#52636c",
    fontFamily: "Nunito Sans, Arial, sans-serif",
    fontSize: 11,
    fontWeight: 600,
    textAlign: "center",
    padding: 12,
  },
});

const formatPeriod = (period: string) => {
  const match = period.match(/^(\d{4})\s+(Q[1-4])$/i);
  return match ? `${match[2].toUpperCase()} ${match[1]}` : period;
};

function preparePage(
  page: ReportPage,
  report: IndustrialMarketReport,
  presentationData: unknown,
  provider: ReportProviderId,
  unavailable: Set<DatasetSection>,
): ReportPage {
  const elements = page.elements.flatMap((element) => {
    if (element.binding) {
      const value = getByContextPath(
        presentationData,
        element.binding.path,
        element.bindingContext,
      );
      if (element.type === "text") {
        element = {
          ...element,
          text:
            value == null || value === ""
              ? (element.binding.fallback ?? "")
              : formatValue(value, element.binding),
        };
      } else if (element.type === "image") {
        element = {
          ...element,
          src: typeof value === "string" ? value : "",
        };
      }
    }

    if (element.type === "table" && element.id === "indicator-table") {
      element = {
        ...element,
        columns: element.columns.map((column, index) =>
          index === 0
            ? column
            : {
                ...column,
                label: report.historicalPeriods[index - 1]
                  ? formatPeriod(report.historicalPeriods[index - 1].period)
                  : "—",
              },
        ),
      };
    }

    if (!element.requiredDataSection) return element;
    const contextAvailable = element.bindingContext
      ? getByPath(presentationData, element.bindingContext.path) != null
      : true;
    const dynamicElement =
      Boolean(element.binding) ||
      element.type === "table" ||
      element.type === "chart" ||
      Boolean(element.repeat);
    const remove =
      unavailable.has(element.requiredDataSection) ||
      !contextAvailable ||
      (provider !== "sample" && !dynamicElement && !element.bindingContext);
    if (!remove) return element;
    return element.type === "image" || element.type === "chart"
      ? unavailablePlaceholder(element)
      : [];
  });
  return { ...page, elements };
}

/**
 * Removes unavailable or fixture-only visual content before page expansion.
 * Static sample artwork is never allowed to masquerade as imported production data.
 */
export function prepareTemplateForReport(
  template: ReportTemplate,
  report: IndustrialMarketReport,
  presentationData: unknown,
  provider: ReportProviderId,
): ReportTemplate {
  const unavailable = new Set(
    report.dataCompleteness
      .filter(
        (item) => item.status === "missing" || item.status === "not-requested",
      )
      .map((item) => item.section),
  );
  return {
    ...structuredClone(template),
    pages: template.pages.map((page) =>
      preparePage(
        structuredClone(page),
        report,
        presentationData,
        provider,
        unavailable,
      ),
    ),
  };
}
