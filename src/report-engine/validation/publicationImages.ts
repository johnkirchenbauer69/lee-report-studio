import type { ImageElement, ReportTemplate } from "../../types/report";

export interface PublicationImageIssue {
  level: "error";
  kind: "image";
  code: "MISSING_REQUIRED_IMAGE" | "UNRESOLVED_IMAGE_ASSET";
  pageId: string;
  elementId: string;
  message: string;
}

export const publicationImageElements = (template: ReportTemplate) =>
  template.pages.flatMap((page) =>
    page.hidden
      ? []
      : page.elements.flatMap((element) =>
          element.type === "image" && !element.hidden
            ? [{ page, element: element as ImageElement }]
            : [],
        ),
  );

/** Pure structural preflight shared by browser export and the PDF API. */
export function validatePublicationImages(
  template: ReportTemplate,
): PublicationImageIssue[] {
  return publicationImageElements(template).flatMap<PublicationImageIssue>(
    ({ page, element }) => {
      const src = element.src?.trim();
      if (!src && element.publicationRequired !== false)
        return [
          {
            level: "error" as const,
            kind: "image" as const,
            code: "MISSING_REQUIRED_IMAGE" as const,
            pageId: page.id,
            elementId: element.id,
            message: `${element.name} is missing a required image source.`,
          },
        ];
      if (element.assetId) {
        const asset = template.assets?.find(
          (item) => item.id === element.assetId,
        );
        if (!asset || (asset.type !== "image" && asset.type !== "logo"))
          return [
            {
              level: "error" as const,
              kind: "image" as const,
              code: "UNRESOLVED_IMAGE_ASSET" as const,
              pageId: page.id,
              elementId: element.id,
              message: `${element.name} references a missing managed image asset.`,
            },
          ];
      }
      return [];
    },
  );
}
