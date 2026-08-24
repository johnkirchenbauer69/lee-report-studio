import { getByPath } from "../../engine/bindings";
import type {
  ReportElement,
  ReportPage,
  ReportTemplate,
  RepeatRule,
} from "../../types/report";
import { chicagoSubmarketId, resolveChicagoSubmarket } from "../submarkets";

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
    return orderedItems(data, rule).map(
      ({ index }, outputIndex) =>
        ({
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
          bindingContext: {
            name: rule.contextName ?? "item",
            path: `${rule.sourcePath}[${index}]`,
          },
        }) as ReportElement,
    );
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
            repeat: undefined,
            bindingContext: context,
            elements: expandRepeatingElements(groupPage.elements, data).map(
              (element) => ({
                ...element,
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
              }),
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
  return result.map((page, index) => ({
    ...page,
    pageNumber: index + 1,
    elements: page.elements.map((element) =>
      element.type === "text" && element.name === "Page Number"
        ? { ...element, text: String(index + 1) }
        : element,
    ),
  }));
}
