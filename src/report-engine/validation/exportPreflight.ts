import type {
  ImageElement,
  ReportTemplate,
  TextElement,
} from "../../types/report";

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
      if (
        !element.allowOverflow &&
        (element.x < 0 ||
          element.y < 0 ||
          element.x + element.width > page.width ||
          element.y + element.height > page.height)
      )
        issues.push({
          level: "error",
          kind: "overflow",
          pageId: page.id,
          elementId: element.id,
          message: `${element.name} extends outside ${page.name}.`,
        });
      if (element.type === "text") {
        const family =
          (element as TextElement).style.typography?.fontFamily ??
          element.style.fontFamily;
        if (
          family &&
          !document.fonts.check(`12px "${family.split(",")[0].trim()}"`)
        )
          issues.push({
            level: "warning",
            kind: "font",
            pageId: page.id,
            elementId: element.id,
            message: `${family} is unavailable; PDF line wrapping may differ.`,
          });
      }
      if (element.type === "image" && (element as ImageElement).src) {
        const image = await loadImage((element as ImageElement).src);
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
