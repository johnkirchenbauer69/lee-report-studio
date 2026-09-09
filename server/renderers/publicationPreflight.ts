import type { ReportTemplate } from "../../src/types/report.ts";
import {
  publicationImageElements,
  validatePublicationImages,
  type PublicationImageIssue,
} from "../../src/report-engine/validation/publicationImages.ts";

export async function runServerPublicationImagePreflight(
  template: ReportTemplate,
  options: { baseUrl: string; fetch?: typeof fetch },
): Promise<PublicationImageIssue[]> {
  const issues = validatePublicationImages(template);
  const structurallyInvalid = new Set(issues.map((issue) => issue.elementId));
  for (const { page, element } of publicationImageElements(template)) {
    const src = element.src?.trim();
    if (!src || structurallyInvalid.has(element.id)) continue;
    if (/^data:image\//i.test(src)) continue;
    try {
      const response = await (options.fetch ?? fetch)(
        new URL(src, options.baseUrl),
        // Only headers are needed. HEAD prevents large image bodies from
        // entering Undici's response stream and guarantees there is no body
        // lifecycle to leak between repeated preflight requests.
        { method: "HEAD" },
      );
      const contentType = response.headers.get("content-type") ?? "unknown";
      if (!response.ok || !/^image\//i.test(contentType))
        issues.push({
          level: "error",
          kind: "image",
          code: "UNRESOLVED_IMAGE_ASSET",
          pageId: page.id,
          elementId: element.id,
          message: `${element.name} could not be resolved as image content.`,
        });
    } catch {
      issues.push({
        level: "error",
        kind: "image",
        code: "UNRESOLVED_IMAGE_ASSET",
        pageId: page.id,
        elementId: element.id,
        message: `${element.name} could not be loaded for publication.`,
      });
    }
  }
  return issues;
}
