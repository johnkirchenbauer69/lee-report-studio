import type { ReportInstance } from "../schema/generation";
import type {
  ReportElement,
  ReportPage,
  TableElement,
} from "../../types/report";
import {
  getByContextPath,
  getByPath,
  formatValue,
} from "../../engine/bindings";
import { buildPresentationModel } from "../bindings/presentationModel";
import {
  CATEGORIES,
  type Category,
  type ExportAsset,
  type ExportPlan,
  type ExportRequest,
  type MarketSection,
} from "./contracts";
import {
  assertArchivePath,
  displayPeriod,
  readableName,
  uniqueName,
} from "./naming";

export function snapshotPresentation(instance: ReportInstance) {
  const data = buildPresentationModel(instance.dataSnapshot, {
    savedMetricsOnly: true,
  });
  // The presentation adapter's current map defaults are never an export source.
  data.overallMarketMapAssetUrl = "";
  data.submarketDetails.forEach((detail) => {
    detail.mapAssetUrl = "";
  });
  return data;
}

export function discoverMarkets(instance: ReportInstance): MarketSection[] {
  const markets = new Map<string, MarketSection>();
  for (const page of instance.pages) {
    if (page.hidden || !page.geographyId) continue;
    const raw = page.bindingContext
      ? getByPath(instance.dataSnapshot, page.bindingContext.path)
      : undefined;
    const source =
      raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : { ...instance.dataSnapshot, ...instance.dataSnapshot.overallMarket };
    const narrative = instance.narratives.find(
      (n) => n.marketId === page.geographyId,
    );
    const name = String(
      source.displayName ??
        source.name ??
        narrative?.marketName ??
        instance.dataSnapshot.report.market,
    );
    const existing = markets.get(page.geographyId);
    if (existing) existing.pages.push(page);
    else
      markets.set(page.geographyId, {
        id: page.geographyId,
        name,
        source,
        pages: [page],
      });
  }
  return [...markets.values()];
}

export function elementText(
  instance: ReportInstance,
  element: ReportElement,
  data: unknown,
) {
  if (element.type !== "text") return "";
  const override = instance.manualOverrides.find(
    (o) =>
      o.elementId === element.id && o.bindingPath === element.binding?.path,
  );
  return override
    ? String(override.overrideValue ?? "")
    : element.binding
      ? formatValue(
          getByContextPath(data, element.binding.path, element.bindingContext),
          element.binding,
        )
      : element.text;
}

export function elementBounds(e: ReportElement) {
  const angle = ((e.rotation ?? 0) * Math.PI) / 180;
  const w =
    Math.abs(e.width * Math.cos(angle)) + Math.abs(e.height * Math.sin(angle));
  const h =
    Math.abs(e.width * Math.sin(angle)) + Math.abs(e.height * Math.cos(angle));
  return {
    x: e.x + (e.width - w) / 2,
    y: e.y + (e.height - h) / 2,
    width: w,
    height: h,
  };
}
export function fragment(page: ReportPage, primary: ReportElement[]) {
  const boxes = primary.map(elementBounds);
  const left = Math.min(...boxes.map((b) => b.x)),
    top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width)),
    bottom = Math.max(...boxes.map((b) => b.y + b.height));
  const propertySlots = primary.flatMap((e) =>
    e.type === "image" || e.type === "text"
      ? (e.binding?.path.match(
          /top(?:Availabilities|Deliveries|Construction)\[\d+\]/g,
        ) ?? [])
      : [],
  );
  const extras = page.elements.filter((e) => {
    if (e.hidden || primary.includes(e) || !["text", "shape"].includes(e.type))
      return false;
    const b = elementBounds(e);
    const header =
      b.y >= top - 30 &&
      b.y + b.height <= top + 2 &&
      b.x >= left - 2 &&
      b.x + b.width <= right + 2;
    const ribbon =
      b.width <= 30 &&
      b.x >= left - 30 &&
      b.x + b.width <= left + 2 &&
      Math.abs(b.y - top) < 2 &&
      b.height <= bottom - top + 2;
    const contained =
      b.x >= left - 1 &&
      b.y >= top - 1 &&
      b.x + b.width <= right + 1 &&
      b.y + b.height <= bottom + 1;
    return (
      propertySlots.some((slot) => e.bindingContext?.path.endsWith(slot)) ||
      contained ||
      header ||
      ribbon ||
      primary.some((p) => p.groupId && p.groupId === e.groupId)
    );
  });
  return [...primary, ...extras].sort(
    (a, b) => page.elements.indexOf(a) - page.elements.indexOf(b),
  );
}
export function fragmentPage(
  page: ReportPage,
  elements: ReportElement[],
  transparent: boolean,
): ReportPage {
  const boxes = elements.map(elementBounds),
    pad = 4;
  const x = Math.min(...boxes.map((b) => b.x)) - pad,
    y = Math.min(...boxes.map((b) => b.y)) - pad;
  const width = Math.max(...boxes.map((b) => b.x + b.width)) - x + pad;
  const height = Math.max(...boxes.map((b) => b.y + b.height)) - y + pad;
  return {
    ...page,
    width,
    height,
    background: transparent ? "transparent" : page.background,
    elements: elements.map((e) => ({ ...e, x: e.x - x, y: e.y - y })),
  };
}

/** No parsing of arbitrary text as numbers; only published numeric table columns are decoded. */
export function numericDisplay(value: unknown, format: string) {
  if (typeof value === "number") return { value, format };
  const text = String(value ?? "").trim();
  if (!text || /^[—–-]$/.test(text)) return { value: null, format };
  const stripped = text.replace(/[$,%\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(stripped)) return { value: text, format: "text" };
  const number = Number(stripped);
  return { value: text.includes("%") ? number / 100 : number, format };
}
export function tablePayload(
  table: TableElement,
  data: unknown,
  market: MarketSection,
) {
  const rows = getByContextPath(data, table.sourcePath, table.bindingContext);
  const shown = (Array.isArray(rows) ? rows : []).slice(
    0,
    table.maxRows ?? 100,
  );
  return {
    title: table.name,
    headers: table.columns.map((c) => c.label),
    rows: shown
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row }) =>
          !table.variant?.includes("transactions") ||
          getByPath(row, "party") !== "-",
      )
      .map(({ row, index }) =>
        table.columns.map((col, columnIndex) => {
          let value = getByPath(row, col.path),
            format = col.format ?? "text";
          if (table.variant === "indicators" && columnIndex > 0) {
            const period = (
              market.source.historicalPeriods as
                Record<string, unknown>[] | undefined
            )?.[columnIndex - 1];
            value = period?.[String(getByPath(row, "metricKey"))];
            format = /Rate$/.test(String(getByPath(row, "metricKey")))
              ? "percentage"
              : "integer";
          } else if (
            table.variant === "transactions" &&
            col.path === "amount"
          ) {
            const lease = /lease/i.test(table.name);
            const record = (
              market.source[lease ? "leasing" : "sales"] as
                Record<string, unknown>[] | undefined
            )?.[index];
            value = record?.[lease ? "sizeSf" : "price"] ?? value;
            format = lease ? "integer" : "currency";
          }
          const parsed =
            format !== "text" ||
            (typeof value === "string" &&
              /^[\s$\d,.%-]+$/.test(value) &&
              (table.variant === "indicators" || col.path === "amount"))
              ? numericDisplay(
                  value,
                  format === "text"
                    ? String(value).includes("%")
                      ? "percentage"
                      : /PRICE|\$/i.test(col.label)
                        ? "currency"
                        : "integer"
                    : format,
                )
              : { value: value ?? null, format: "text" };
          return {
            ...parsed,
            current: table.variant === "indicators" && columnIndex === 1,
          };
        }),
      ),
  };
}

export function buildExportPlan(
  instance: ReportInstance,
  request: ExportRequest,
  snapshotHash: string,
): ExportPlan {
  const all = discoverMarkets(instance),
    data = snapshotPresentation(instance);
  if (
    new Set(request.markets).size !== request.markets.length ||
    new Set(request.categories).size !== request.categories.length
  )
    throw new Error("Choose each market and category only once.");
  const selected = request.markets.map((id) => {
    const market = all.find((m) => m.id === id);
    if (!market)
      throw new Error(
        "A selected market is not contained in this saved report.",
      );
    return market;
  });
  const period = displayPeriod(instance.dataSnapshot.report.period),
    multi = selected.length > 1;
  const usedFolders = new Set<string>(),
    root = readableName(
      multi ? `${period} Industrial Market Asset Export` : selected[0].name,
      60,
    );
  const assets: ExportAsset[] = [],
    warnings: string[] = [],
    usedPaths = new Set<string>();
  const add = (
    market: MarketSection,
    folder: string,
    category: Category,
    title: string,
    format: ExportAsset["format"],
    content: Partial<ExportAsset>,
  ) => {
    const filename = uniqueName(
      `${readableName(`${market.name} ${title} - ${period}`, 95)}.${format}`,
      usedPaths,
    );
    const path = `${root}/${multi ? `${folder}/` : ""}${CATEGORIES[category].folder}/${filename}`;
    assertArchivePath(path);
    assets.push({
      id: `asset-${assets.length}`,
      marketId: market.id,
      market: market.name,
      category,
      title,
      format,
      path,
      warnings: [],
      ...content,
    });
  };
  for (const market of selected) {
    const folder = uniqueName(readableName(market.name, 45), usedFolders);
    for (const category of request.categories) {
      const before = assets.length;
      if (category === "section")
        add(market, folder, category, "Industrial Market Section", "pdf", {
          payload: market.pages,
        });
      if (category === "statistics") {
        const metrics = Object.entries(
          (market.source.metrics ?? market.source) as Record<string, unknown>,
        ).filter(
          ([key, value]) =>
            typeof value === "number" &&
            /Sf$|Rate$|Share$|Psf$|Volume$/.test(key),
        );
        if (metrics.length)
          add(market, folder, category, "Market Statistics", "xlsx", {
            payload: {
              metrics,
              periods: market.source.historicalPeriods ?? [],
            },
          });
      }
      const transactionTables: ReturnType<typeof tablePayload>[] = [];
      const propertyGroups: { title: string; rows: unknown[] }[] = [];
      for (const page of market.pages) {
        for (const element of page.elements.filter((e) => !e.hidden)) {
          if (category === "charts" && element.type === "chart") {
            const rows = getByContextPath(
              data,
              element.sourcePath,
              element.bindingContext,
            );
            if (
              !Array.isArray(rows) ||
              !rows.length ||
              element.unavailableMessage
            ) {
              warnings.push(
                `${market.name}: ${element.name} is unavailable in the saved snapshot.`,
              );
              continue;
            }
            add(
              market,
              folder,
              category,
              element.title || element.name,
              "png",
              { page, elements: fragment(page, [element]) },
            );
          }
          if (
            (category === "indicators" &&
              element.type === "table" &&
              element.variant === "indicators") ||
            (category === "transactions" &&
              element.type === "table" &&
              element.variant === "transactions")
          ) {
            const table = element as TableElement,
              payload = tablePayload(table, data, market);
            if (!payload.rows.length) {
              warnings.push(
                `${market.name}: ${table.name} has no saved records.`,
              );
              continue;
            }
            add(market, folder, category, table.name, "png", {
              page,
              elements: fragment(page, [element]),
            });
            if (category === "indicators")
              add(market, folder, category, table.name, "xlsx", { payload });
            else transactionTables.push(payload);
          }
          if (
            category === "narrative" &&
            element.type === "text" &&
            (/\.narrative$|^overallMarket.narrative$/.test(
              element.binding?.path ?? "",
            ) ||
              element.name === "Market Narrative")
          ) {
            const text = elementText(instance, element, data);
            if (text.trim())
              add(
                market,
                folder,
                category,
                "Industrial Market Narrative",
                "docx",
                {
                  text,
                  payload: {
                    heading: element.name,
                    bold:
                      Number(
                        element.style.typography?.fontWeight ??
                          element.style.fontWeight ??
                          400,
                      ) >= 700,
                  },
                },
              );
          }
          if (
            category === "map" &&
            element.type === "image" &&
            /map/i.test(element.name) &&
            element.src
          )
            add(market, folder, category, element.name, "png", {
              page,
              elements: [element],
              warnings: [
                "Raster maps retain their original source detail; a larger PNG does not add geographic detail.",
              ],
            });
        }
        if (category === "properties") {
          for (const [path, title] of [
            ["topAvailabilities", "Top Availabilities"],
            ["topDeliveries", "Deliveries"],
            ["topConstruction", "Under Construction"],
          ]) {
            const elements = page.elements.filter(
              (e) =>
                e.type !== "shape" &&
                new RegExp(`(?:^|[. ])${path}\\[`).test(
                  e.type === "text" || e.type === "image"
                    ? `${e.binding?.path ?? ""} ${e.bindingContext?.path ?? ""}`
                    : "",
                ),
            );
            if (!elements.length) continue;
            const rows = page.bindingContext
              ? getByContextPath(data, `market.${path}`, page.bindingContext)
              : getByPath(data, path);
            const indexes = new Set(
              elements.map((e) =>
                Number(
                  (e.type === "text" || e.type === "image"
                    ? `${e.binding?.path ?? ""} ${e.bindingContext?.path ?? ""}`
                    : ""
                  )?.match(/\[(\d+)\]/)?.[1],
                ),
              ),
            );
            const records = (Array.isArray(rows) ? rows : []).filter(
              (r, i) => indexes.has(i) && r.state !== "none",
            );
            propertyGroups.push({
              title,
              rows: records.map((r) => ({
                address: r.address,
                sizeSf: r.sizeSf,
                detail: r.detail,
              })),
            });
            if (records.length)
              add(market, folder, category, title, "png", {
                page,
                elements: fragment(page, elements),
              });
            else
              warnings.push(
                `${market.name}: ${title} has no qualifying saved records.`,
              );
          }
        }
      }
      if (category === "transactions" && transactionTables.length)
        add(market, folder, category, "Top Leases and Sales", "xlsx", {
          payload: transactionTables,
        });
      if (category === "properties" && propertyGroups.length)
        add(market, folder, category, "Property Highlights", "xlsx", {
          payload: [
            ["Top Availabilities", "availabilities"],
            ["Deliveries", "deliveries"],
            ["Under Construction", "construction"],
          ].map(
            ([title, sourceKey]) =>
              propertyGroups.find((group) => group.title === title) ?? {
                title,
                rows: [],
                emptyMessage:
                  Array.isArray(market.source[sourceKey]) &&
                  market.source[sourceKey].length === 0
                    ? "No qualifying records in this saved report."
                    : "This section is not displayed in the saved report.",
              },
          ),
        });
      if (assets.length === before)
        warnings.push(
          `${market.name}: ${CATEGORIES[category].label} is not available in this saved report.`,
        );
    }
  }
  if (assets.length > 600)
    throw new Error(
      "This selection exceeds the 600-file export limit. Export fewer markets or categories.",
    );
  return {
    reportId: instance.id,
    reportName: instance.dataSnapshot.report.title,
    period,
    status: instance.status,
    revision: instance.revision,
    snapshotHash,
    templateVersion: instance.templateVersion,
    generatedAt: instance.generatedAt,
    root,
    zipName: `${root}${multi ? "" : ` Industrial Market Assets - ${readableName(period, 20)}`}.zip`,
    selectedMarkets: selected.map(({ id, name }) => ({ id, name })),
    categories: request.categories,
    assets,
    warnings,
  };
}
