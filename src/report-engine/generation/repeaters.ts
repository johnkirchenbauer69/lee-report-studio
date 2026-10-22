import { getByContextPath, getByPath } from "../../engine/bindings";
import type {
  ReportElement,
  ReportPage,
  ReportTemplate,
  RepeatRule,
} from "../../types/report";
import { chicagoSubmarketId, resolveChicagoSubmarket } from "../submarkets";
import { layoutActivitySidebar } from "../geographic/sidebarLayout";
import {
  applyPageNavigationIdentity,
  assertUniquePageAnchors,
} from "../navigation/pageNavigation";

const resolveBoundImage = (
  element: ReportElement,
  data: unknown,
  context: { name: string; path: string },
): ReportElement => {
  if (element.type !== "image" || !element.binding) return element;
  const value = getByContextPath(data, element.binding.path, context);
  const src = typeof value === "string" ? value.trim() : "";
  return {
    ...element,
    src,
    // A repeated slot with no source is an explicit data-availability state,
    // not a broken image URL. Non-empty sources remain publication-required
    // and are verified by server preflight.
    ...(src || element.binding.path === "market.activityMapAssetUrl" ? {} : { publicationRequired: false }),
  };
};

function orderedItems(
  data: unknown,
  rule: RepeatRule,
  allowedIds?: Set<string>,
): { item: unknown; index: number }[] {
  const source = getByPath(data, rule.sourcePath);
  if (!Array.isArray(source)) return [];
  const indexed = source
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (!allowedIds) return true;
      const id =
        String(getByPath(item, "id") ?? "") ||
        chicagoSubmarketId(String(getByPath(item, "canonicalName") ?? "")) ||
        chicagoSubmarketId(String(getByPath(item, "name") ?? "")) ||
        "";
      return allowedIds.has(id);
    });
  if (rule.sortBy)
    indexed.sort(
      (a, b) =>
        String(getByPath(a.item, rule.sortBy!)).localeCompare(
          String(getByPath(b.item, rule.sortBy!)),
        ) * (rule.sortOrder === "descending" ? -1 : 1),
    );
  return indexed.slice(0, rule.maximumItems ?? indexed.length);
}

export function expandRepeatingElements(
  elements: ReportElement[],
  data: unknown,
): ReportElement[] {
  return elements.flatMap((element) => {
    if (!element.repeat) return element;
    const rule = element.repeat;
    const spacing = rule.spacing ?? 12;
    return orderedItems(data, rule).map(({ index }, outputIndex) => {
      const context = {
        name: rule.contextName ?? "item",
        path: `${rule.sourcePath}[${index}]`,
      };
      return resolveBoundImage(
        {
          ...structuredClone(element),
          id: `${element.id}-repeat-${index}`,
          name: `${element.name} ${outputIndex + 1}`,
          x:
            element.x +
            (rule.direction === "horizontal"
              ? (element.width + spacing) * outputIndex
              : 0),
          y:
            element.y +
            (rule.direction !== "horizontal"
              ? (element.height + spacing) * outputIndex
              : 0),
          repeat: undefined,
          bindingContext: context,
        } as ReportElement,
        data,
        context,
      );
    });
  });
}

export function expandTemplatePages(
  template: ReportTemplate,
  data: unknown,
  pageSelection?: { submarketIds?: string[]; submarkets?: string[] },
): ReportPage[] {
  const requested =
    pageSelection?.submarketIds ?? pageSelection?.submarkets ?? undefined;
  const selectedIds = requested
    ? requested.map((value) => {
        const identity = resolveChicagoSubmarket(value);
        if (!identity)
          throw new Error(`Unknown selected Chicago submarket: ${value}.`);
        return identity.id;
      })
    : undefined;
  if (selectedIds && new Set(selectedIds).size !== selectedIds.length)
    throw new Error(
      "Selected submarkets must resolve to unique canonical IDs.",
    );
  const allowedIds = selectedIds ? new Set(selectedIds) : undefined;
  const generatedIds = new Set<string>();
  const result: ReportPage[] = [];
  for (let pageIndex = 0; pageIndex < template.pages.length; pageIndex += 1) {
    const page = template.pages[pageIndex]!;
    if (!page.repeat) {
      result.push({
        ...structuredClone(page),
        elements: expandRepeatingElements(page.elements, data),
      });
      continue;
    }
    const group = [page];
    while (
      template.pages[pageIndex + 1]?.repeat?.sourcePath ===
        page.repeat.sourcePath &&
      template.pages[pageIndex + 1]?.repeat?.contextName ===
        page.repeat.contextName
    )
      group.push(template.pages[++pageIndex]!);
    const rule = page.repeat;
    const selection =
      ["submarkets", "submarketDetails"].includes(rule.sourcePath) &&
      pageSelection
        ? allowedIds
        : undefined;
    orderedItems(data, rule, selection).forEach(
      ({ item, index }, outputIndex) => {
        const identity = resolveChicagoSubmarket(
          String(
            getByPath(item, "id") ??
              getByPath(item, "canonicalName") ??
              getByPath(item, "name") ??
              "",
          ),
        );
        if (identity) generatedIds.add(identity.id);
        group.forEach((groupPage) => {
          const label = String(
            getByPath(item, "displayName") ??
              getByPath(item, "name") ??
              outputIndex + 1,
          );
          const context = {
            name: rule.contextName,
            path: `${rule.sourcePath}[${index}]`,
          };
          const periods = getByPath(item, "historicalPeriods");
          const formatPeriod = (value: unknown) => {
            const text = String(value ?? "");
            const match = text.match(/^(\d{4})\s+(Q[1-4])$/i);
            return match
              ? `${match[2]!.toUpperCase()} ${match[1]}`
              : text || "—";
          };
          result.push({
            ...structuredClone(groupPage),
            id: `${groupPage.id}-repeat-${index}`,
            name: groupPage.name.replace(/\{item\}/g, label),
            geographyId: identity?.id,
            repeat: undefined,
            bindingContext: context,
            elements: expandRepeatingElements(groupPage.elements, data).map(
              (element) => {
                const bound = resolveBoundImage(
                  element,
                  data,
                  element.bindingContext ?? context,
                );
                return {
                  ...bound,
                  ...(element.type === "image" &&
                  element.binding?.path === "market.mapAssetUrl"
                    ? { src: String(getByPath(item, "mapAssetUrl") ?? "") }
                    : {}),
                  ...(element.type === "table" &&
                  element.id.includes("indicator-table") &&
                  Array.isArray(periods)
                    ? {
                        columns: element.columns.map((column, columnIndex) =>
                          columnIndex === 0
                            ? column
                            : {
                                ...column,
                                label: formatPeriod(
                                  getByPath(periods[columnIndex - 1], "period"),
                                ),
                              },
                        ),
                      }
                    : {}),
                  bindingContext: element.bindingContext ?? context,
                };
              },
            ),
          });
        });
      },
    );
  }
  if (allowedIds) {
    const missing = [...allowedIds].filter((id) => !generatedIds.has(id));
    if (missing.length)
      throw new Error(
        `Selected canonical submarkets were not generated: ${missing.join(", ")}.`,
      );
  }
  const finalized = result.map((page, index) =>
    applyPageNavigationIdentity({
      ...page,
      pageNumber: index + 1,
      elements: page.elements.map((element) =>
        element.type === "text" && element.name === "Page Number"
          ? { ...element, text: String(index + 1) }
          : element,
      ),
    }),
  );
  assertUniquePageAnchors(finalized);
  return finalized.map(page => {
    const laidOut = layoutActivitySidebar(page, data);
    return { ...laidOut, elements: laidOut.elements.map(element => {
      if (element.type === "text" && /^(overall-)?featured-(area|address|details)$/.test(element.id)) {
        const value = element.binding ? getByContextPath(data, element.binding.path,
          element.bindingContext ?? laidOut.bindingContext) : undefined;
        const length = typeof value === "string" ? value.length : 0;
        const isArea = element.id.endsWith("-area");
        const isAddress = element.id.endsWith("-address");
        const longAddress = isAddress && length > 34;
        const addressValue = getByContextPath(data, element.binding?.path.replace(/\.details$/, ".address") ?? "",
          element.bindingContext ?? laidOut.bindingContext);
        const detailsAfterLongAddress = element.id.endsWith("-details") &&
          typeof addressValue === "string" && addressValue.length > 34;
        const size = isArea ? (length > 27 ? 12.5 : length > 21 ? 14 : 16) : longAddress ? 8.8 : undefined;
        return { ...element,
          ...(longAddress ? { y: 243 * 4 / 3, height: 21 * 4 / 3 } : {}),
          ...(detailsAfterLongAddress ? { y: 264 * 4 / 3, height: 8 * 4 / 3 } : {}),
          ...(size ? { style: { ...element.style, fontSize: size * 4 / 3,
            typography: element.style.typography ? { ...element.style.typography, fontSize: size * 4 / 3 } : undefined } } : {}),
        };
      }
      if (element.id !== "featured-status-badge" && element.id !== "overall-featured-status-badge") return element;
      const badge = element.binding
        ? getByContextPath(data, element.binding.path, element.bindingContext ?? laidOut.bindingContext)
        : undefined;
      return { ...element, hidden: typeof badge !== "string" || !badge.trim() };
    }) };
  });
}
