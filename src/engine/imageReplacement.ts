import type { Asset, ImageElement, ReportTemplate } from "../types/report";

export const DEFAULT_IMAGE_CROP = { x: 50, y: 50, zoom: 1 } as const;

export function replaceImageAsset(
  element: ImageElement,
  asset: Asset,
): ImageElement {
  const { sourceCrop: _sourceCrop, ...preserved } = element;
  return {
    ...preserved,
    src: asset.source,
    assetId: asset.id,
    crop: { ...DEFAULT_IMAGE_CROP },
  };
}

export function replaceTemplateImageAsset(
  template: ReportTemplate,
  elementId: string,
  asset: Asset,
): ReportTemplate {
  return {
    ...template,
    pages: template.pages.map((page) => ({
      ...page,
      elements: page.elements.map((element) =>
        element.id === elementId && element.type === "image"
          ? replaceImageAsset(element, asset)
          : element,
      ),
    })),
  };
}
