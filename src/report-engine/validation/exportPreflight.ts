import type {
  ImageElement,
  ReportTemplate,
  TextElement,
} from "../../types/report";
import { elementRect, getRotatedAabb } from "../../engine/geometry";
import {
  BRAND_FONT_FAMILY,
  normalizeSemanticFontFamily,
  resolveManagedFontFace,
} from "../../services/fontRegistry";
import { resolveTypography } from "../../engine/typography";

export interface ExportPreflightIssue {
  level: "warning" | "error";
  kind: "font" | "image" | "overflow";
  pageId: string;
  elementId: string;
  message: string;
}

export async function runExportPreflight(
  template: ReportTemplate,
): Promise<ExportPreflightIssue[]> {
  const issues: ExportPreflightIssue[] = [];
  for (const page of template.pages) {
    for (const element of page.elements) {
      if (element.hidden) continue;
      const bounds = getRotatedAabb(elementRect(element));
      if (
        !element.allowOverflow &&
        (bounds.x < 0 ||
          bounds.y < 0 ||
          bounds.x + bounds.width > page.width ||
          bounds.y + bounds.height > page.height)
      )
        issues.push({
          level: "error",
          kind: "overflow",
          pageId: page.id,
          elementId: element.id,
          message: `${element.name} extends outside ${page.name}.`,
        });
      if (element.type === "text") {
        const typography = resolveTypography((element as TextElement).style);
        const family = normalizeSemanticFontFamily(typography.fontFamily);
        const managed = typography?.fontAssetId
          ? template.assets?.find(
              (asset) => asset.id === typography.fontAssetId,
            )
          : undefined;
        const expectedManaged = resolveManagedFontFace(
          template.assets ?? [],
          family,
          Number(typography.fontWeight) || 400,
          typography.fontStyle ?? (typography.italic ? "italic" : "normal"),
        );
        if (
          typography?.fontAssetId &&
          (!managed || managed.checksum !== typography.fontChecksum)
        )
          issues.push({
            level: "error",
            kind: "font",
            pageId: page.id,
            elementId: element.id,
            message: `${element.name} references a missing or changed managed font face.`,
          });
        else if (expectedManaged && !typography.fontAssetId)
          issues.push({
            level: "error",
            kind: "font",
            pageId: page.id,
            elementId: element.id,
            message: `${element.name} does not pin the available managed ${family} face.`,
          });
        else if (family === BRAND_FONT_FAMILY && !expectedManaged)
          issues.push({
            level: "error",
            kind: "font",
            pageId: page.id,
            elementId: element.id,
            message: `${element.name} requires managed ${BRAND_FONT_FAMILY} ${typography.fontWeight} ${typography.fontStyle ?? "normal"}, but that face is unavailable.`,
          });
        else if (
          family &&
          !document.fonts.check(
            `${typography.fontStyle ?? "normal"} ${typography.fontWeight ?? 400} 12px "${family}"`,
            "LEE managed font verification",
          )
        )
          issues.push({
            level: managed ? "error" : "warning",
            kind: "font",
            pageId: page.id,
            elementId: element.id,
            message: `${family} is unavailable; PDF line wrapping may differ.`,
          });
      }
      if (element.type === "image" && (element as ImageElement).src) {
        const src = (element as ImageElement).src;
        const contentTypeIssue = await checkImageContentType(src);
        if (contentTypeIssue) {
          issues.push({
            level: "error",
            kind: "image",
            pageId: page.id,
            elementId: element.id,
            message: `Image preflight failed: ${element.name} resolved to ${contentTypeIssue} instead of an image.`,
          });
          continue;
        }
        const image = await loadImage(src);
        if (!image)
          issues.push({
            level: "error",
            kind: "image",
            pageId: page.id,
            elementId: element.id,
            message: `${element.name} could not be loaded.`,
          });
        else {
          const dpi = Math.min(
            image.naturalWidth / (element.width / 96),
            image.naturalHeight / (element.height / 96),
          );
          if (dpi < 150)
            issues.push({
              level: "warning",
              kind: "image",
              pageId: page.id,
              elementId: element.id,
              message: `${element.name} is ${Math.round(dpi)} effective DPI; 150+ DPI is recommended.`,
            });
        }
      }
    }
  }
  return deduplicate(issues);
}
/**
 * Confirms an image element's `src` actually resolves to image content
 * before attempting to decode it as one. Catches the case where a
 * relative/bare id (e.g. an un-resolved Salesforce Attachment id) gets
 * served the app's own `index.html` by a dev-server SPA fallback: that
 * request returns `200 text/html`, which `<img>` would otherwise just fail
 * to decode with no indication of *why*. Returns the offending content type
 * (or `undefined` if it looks like an image, or the request itself failed
 * and the existing `loadImage` check should report that instead).
 */
const checkImageContentType = async (
  src: string,
): Promise<string | undefined> => {
  try {
    const response = await fetch(src, { method: "GET" });
    if (!response.ok) return undefined;
    const contentType = response.headers.get("content-type") ?? "unknown";
    return /^image\//i.test(contentType) ? undefined : contentType;
  } catch {
    return undefined;
  }
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement | undefined>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = src;
  });
const deduplicate = (issues: ExportPreflightIssue[]) =>
  issues.filter(
    (issue, index) =>
      issues.findIndex(
        (candidate) =>
          candidate.kind === issue.kind && candidate.message === issue.message,
      ) === index,
  );
