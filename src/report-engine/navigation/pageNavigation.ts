import type { ReportPage } from "../../types/report";

export type ReportPageKind = "overview" | "highlights";

export const stablePageAnchor = (
  geographyId: string,
  pageKind: ReportPageKind,
) => `${geographyId}-${pageKind}`;

export function inferPageKind(page: ReportPage): ReportPageKind | undefined {
  if (page.pageKind) return page.pageKind;
  const identity = `${page.id} ${page.name}`.toLowerCase();
  if (/\boverview\b/.test(identity)) return "overview";
  if (/\bhighlights?\b/.test(identity)) return "highlights";
  return undefined;
}

export function applyPageNavigationIdentity(
  page: ReportPage,
  geographyId?: string,
): ReportPage {
  const pageKind = inferPageKind(page);
  const resolvedGeographyId =
    geographyId ??
    page.geographyId ??
    (page.id === "market-overview" ? "overall-market" : undefined);
  return {
    ...page,
    ...(pageKind ? { pageKind } : {}),
    ...(resolvedGeographyId ? { geographyId: resolvedGeographyId } : {}),
    ...(pageKind && resolvedGeographyId
      ? { anchor: stablePageAnchor(resolvedGeographyId, pageKind) }
      : page.anchor
        ? { anchor: page.anchor }
        : {}),
  };
}

export function resolveOverviewPageTarget(
  pages: readonly ReportPage[],
  geographyId: string,
): ReportPage | undefined {
  const matches = pages.filter(
    (page) =>
      page.geographyId === geographyId && inferPageKind(page) === "overview",
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function assertUniquePageAnchors(pages: readonly ReportPage[]): void {
  const anchors = pages
    .map((page) => page.anchor)
    .filter((anchor): anchor is string => Boolean(anchor));
  if (new Set(anchors).size !== anchors.length)
    throw new Error("Generated report page anchors must be unique.");
}
