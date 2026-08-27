import { resolveTypography } from "../engine/typography";
import type {
  Asset,
  ReportElement,
  ReportTemplate,
  TableCellStyle,
} from "../types/report";
import {
  normalizeSemanticFontFamily,
  resolveAvailableManagedFontFace,
} from "./fontRegistry";

const normalizeCellStyle = (
  style: TableCellStyle | undefined,
  assets: Asset[],
): TableCellStyle | undefined => {
  if (!style?.fontFamily) return style ? { ...style } : undefined;
  const fontFamily = normalizeSemanticFontFamily(style.fontFamily);
  const fontWeight = style.fontWeight ?? 400;
  const fontStyle = style.fontStyle ?? "normal";
  const face = resolveAvailableManagedFontFace(
    assets,
    fontFamily,
    fontWeight,
    fontStyle,
  );
  return {
    ...style,
    fontFamily,
    fontWeight: face?.fontWeight ?? fontWeight,
    fontStyle: face?.fontStyle ?? fontStyle,
    fontAssetId: face?.id,
    fontChecksum: face?.checksum,
  };
};

const normalizeElement = (
  element: ReportElement,
  assets: Asset[],
): ReportElement => {
  const next = structuredClone(element);
  if (next.style.fontFamily) {
    const fontFamily = normalizeSemanticFontFamily(next.style.fontFamily);
    const fontWeight = next.style.fontWeight ?? 400;
    const fontStyle =
      next.style.fontStyle ?? (next.style.italic ? "italic" : "normal");
    const face = resolveAvailableManagedFontFace(
      assets,
      fontFamily,
      fontWeight,
      fontStyle,
    );
    next.style.fontFamily = fontFamily;
    next.style.fontWeight = face?.fontWeight ?? fontWeight;
    next.style.fontStyle = face?.fontStyle ?? fontStyle;
    next.style.fontAssetId = face?.id;
    next.style.fontChecksum = face?.checksum;
  }
  if (next.type === "text") {
    const typography = resolveTypography(next.style);
    const fontFamily = normalizeSemanticFontFamily(typography.fontFamily);
    const fontWeight = Number(typography.fontWeight) || 400;
    const fontStyle =
      typography.fontStyle ?? (typography.italic ? "italic" : "normal");
    const face = resolveAvailableManagedFontFace(
      assets,
      fontFamily,
      fontWeight,
      fontStyle,
    );
    next.style.typography = {
      ...typography,
      fontFamily,
      fontWeight: face?.fontWeight ?? fontWeight,
      fontStyle: face?.fontStyle ?? fontStyle,
      italic: (face?.fontStyle ?? fontStyle) === "italic",
      fontAssetId: face?.id,
      fontChecksum: face?.checksum,
    };
  }
  if (next.type === "table") {
    next.headerStyle = normalizeCellStyle(next.headerStyle, assets);
    next.bodyStyle = normalizeCellStyle(next.bodyStyle, assets);
    next.columns = next.columns.map((column) => ({
      ...column,
      headerStyle: normalizeCellStyle(column.headerStyle, assets),
      bodyStyle: normalizeCellStyle(column.bodyStyle, assets),
    }));
    next.cellStyles = next.cellStyles
      ? Object.fromEntries(
          Object.entries(next.cellStyles).map(([key, style]) => [
            key,
            normalizeCellStyle(style, assets)!,
          ]),
        )
      : undefined;
  }
  if (next.type === "chart" && next.chartStyle?.fontFamily)
    next.chartStyle.fontFamily = normalizeSemanticFontFamily(
      next.chartStyle.fontFamily,
    );
  return next;
};

/** Migrates editable/live typography only; raster/static image pages are untouched. */
export function normalizeReportTemplateFonts(
  template: ReportTemplate,
  managedAssets: Asset[] = template.assets ?? [],
): ReportTemplate {
  const assets = structuredClone(managedAssets);
  return {
    ...structuredClone(template),
    assets,
    pages: template.pages.map((page) => ({
      ...structuredClone(page),
      elements: page.elements.map((element) =>
        normalizeElement(element, assets),
      ),
    })),
  };
}
