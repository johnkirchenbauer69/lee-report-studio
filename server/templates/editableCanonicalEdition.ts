import type { Asset, ReportTemplate } from "../../src/types/report.ts";
import { sampleTemplate } from "../../src/data/sampleTemplate.ts";
import { normalizeReportTemplateFonts } from "../../src/services/templateNormalization.ts";
import { sanitizeSalesforceClientPayload } from "../../src/shared/salesforceIds.ts";

/** Apply only to a new canonical edition. Historical sources/reports stay pinned. */
export function editableCanonicalEdition(
  source: ReportTemplate,
  assets: Asset[],
): ReportTemplate {
  if (
    !["industrial-market-classic", "industrial-market-geographic"].includes(
      source.id,
    )
  )
    throw Error("Expected canonical family");
  const replacements = new Map(
    sampleTemplate.pages.map((page) => [
      page.id,
      page.elements.filter(
        (element) => "closingContent" in element && element.closingContent,
      ),
    ]),
  );
  const template = structuredClone(source);
  template.pages = template.pages.map((page) => {
    const content = replacements.get(page.id);
    if (!content?.length) return page;
    // Keep this edition's headers, footer address, logos and report bindings.
    return {
      ...page,
      elements: [
        ...page.elements.filter(
          (element) =>
            element.id !== `${page.id}-artwork` &&
            !("closingContent" in element && element.closingContent),
        ),
        ...structuredClone(content),
      ],
    };
  });
  // Display names must already match the browser boundary before hashing a new
  // edition. Keep asset identities, storage paths, bytes and old editions intact.
  const displayAssets = assets.map((asset) => ({
    ...asset,
    name: sanitizeSalesforceClientPayload(asset.name),
  }));
  return normalizeReportTemplateFonts(
    { ...template, assets: displayAssets },
    displayAssets,
  );
}
