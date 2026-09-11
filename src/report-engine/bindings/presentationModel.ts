import {
  calculateMarketTotals,
  calculateMetricExtremes,
} from "../calculations/marketCalculations";
import { formatReportValue } from "../formatting/formatValue";
import { resolvePresentationValue } from "../provenance/provenance";
import type {
  IndustrialMarketReport,
  MarketMetrics,
} from "../schema/industrialMarketReport";
import {
  containsSalesforceIdToken,
  sanitizeSalesforceClientPayload,
} from "../../shared/salesforceIds";
import { resolveChicagoSubmarket } from "../submarkets";
import { resolveMarketMapAsset } from "../assets/marketMapAssets";
import {
  buildMetricSemanticFields,
  METRIC_SEMANTICS,
  type IndicatorMetricKey,
} from "../indicators/metricSemantics";

export function assertNoClientFacingSalesforceIds(
  value: unknown,
  path = "presentation",
): void {
  if (typeof value === "string" && containsSalesforceIdToken(value))
    throw new Error(`Unsafe Salesforce record id in client-facing ${path}.`);
  if (Array.isArray(value))
    value.forEach((item, index) =>
      assertNoClientFacingSalesforceIds(item, `${path}[${index}]`),
    );
  else if (value && typeof value === "object")
    Object.entries(value).forEach(([key, item]) =>
      assertNoClientFacingSalesforceIds(item, `${path}.${key}`),
    );
}

const integer = (value: number) =>
  formatReportValue(value, { type: "integer" });
const money = (value: number) =>
  formatReportValue(value, { type: "currency", decimals: 0 });
const percent = (value: number, decimals = 2) =>
  formatReportValue(value, { type: "percentage", decimals });
const rent = (value: number) =>
  formatReportValue(value, { type: "currency", decimals: 2 });
const metricKeys: (keyof MarketMetrics)[] = [
  "inventorySf",
  "deliveredSf",
  "underConstructionSf",
  "speculativeShare",
  "quarterlyNetAbsorptionSf",
  "vacancyRate",
  "availabilityRate",
  "askingNetRentPsf",
  "salesVolume",
];

export function buildPresentationModel(report: IndustrialMarketReport) {
  const periodMatch = report.report.period.match(/^(\d{4})\s+(Q[1-4])$/i);
  const reportDisplay = {
    period: periodMatch
      ? `${periodMatch[2].toUpperCase()} ${periodMatch[1]}`
      : report.report.period,
    year: periodMatch?.[1] ?? report.report.period,
    quarter: periodMatch?.[2].toUpperCase() ?? report.report.period,
  };
  const totals = calculateMarketTotals(report.submarkets);
  const extremes = Object.fromEntries(
    metricKeys.map((key) => [
      key,
      calculateMetricExtremes(report.submarkets, key),
    ]),
  ) as Record<keyof MarketMetrics, ReturnType<typeof calculateMetricExtremes>>;
  const detailRows = report.submarkets.map((item) => ({
    kind: "detail",
    geographyId: resolveChicagoSubmarket(item.name)?.id,
    name: item.name,
    inventory: integer(item.inventorySf),
    delivered: integer(item.deliveredSf),
    underConstruction: integer(item.underConstructionSf),
    speculative: percent(item.speculativeShare, 0),
    absorption: integer(
      resolvePresentationValue(
        report,
        `submarkets.${item.name}.quarterlyNetAbsorptionSf`,
        item.quarterlyNetAbsorptionSf,
      ),
    ),
    vacancy: percent(item.vacancyRate),
    availability: percent(item.availabilityRate),
    rent: rent(item.askingNetRentPsf),
    sales: money(item.salesVolume),
  }));
  const submarketTableRows = [
    ...detailRows,
    {
      kind: "total",
      name: "MARKET TOTALS",
      inventory: integer(totals.inventorySf),
      delivered: integer(totals.deliveredSf),
      underConstruction: integer(totals.underConstructionSf),
      speculative: percent(
        resolvePresentationValue(
          report,
          "overallMarket.speculativeShare",
          totals.speculativeShare,
        ),
        0,
      ),
      absorption: integer(
        resolvePresentationValue(
          report,
          "overallMarket.quarterlyNetAbsorptionSf",
          report.overallMarket.quarterlyNetAbsorptionSf,
        ),
      ),
      vacancy: percent(totals.vacancyRate),
      availability: percent(totals.availabilityRate),
      rent: rent(totals.askingNetRentPsf),
      sales: money(totals.salesVolume),
    },
    {
      kind: "minimum",
      name: "SUBMARKET MIN",
      inventory: extremes.inventorySf.minimum?.name,
      delivered: extremes.deliveredSf.minimum?.name,
      underConstruction: extremes.underConstructionSf.minimum?.name,
      speculative: extremes.speculativeShare.minimum?.name,
      absorption: extremes.quarterlyNetAbsorptionSf.minimum?.name,
      vacancy: extremes.vacancyRate.minimum?.name,
      availability: extremes.availabilityRate.minimum?.name,
      rent: extremes.askingNetRentPsf.minimum?.name,
      sales: extremes.salesVolume.minimum?.name,
    },
    {
      kind: "maximum",
      name: "SUBMARKET MAX",
      inventory: extremes.inventorySf.maximum?.name,
      delivered: extremes.deliveredSf.maximum?.name,
      underConstruction: extremes.underConstructionSf.maximum?.name,
      speculative: extremes.speculativeShare.maximum?.name,
      absorption: extremes.quarterlyNetAbsorptionSf.maximum?.name,
      vacancy: extremes.vacancyRate.maximum?.name,
      availability: extremes.availabilityRate.maximum?.name,
      rent: extremes.askingNetRentPsf.maximum?.name,
      sales: extremes.salesVolume.maximum?.name,
    },
  ];
  const period = (
    periods: IndustrialMarketReport["historicalPeriods"],
    index: number,
    key: keyof IndustrialMarketReport["historicalPeriods"][number],
    formatter: (value: number) => string,
  ) => {
    const value = periods[index]?.[key];
    return typeof value === "number" ? formatter(value) : "—";
  };
  const indicatorFormatter = (metricKey: IndicatorMetricKey, value: number) =>
    metricKey === "vacancyRate" || metricKey === "availabilityRate"
      ? percent(value, 2)
      : integer(value);
  const buildIndicatorRows = (
    periods: IndustrialMarketReport["historicalPeriods"],
  ) =>
    periods.length
      ? METRIC_SEMANTICS.map((definition) => ({
          ...buildMetricSemanticFields(periods, definition),
          q2: period(periods, 0, definition.metricKey, (value) =>
            indicatorFormatter(definition.metricKey, value),
          ),
          q1: period(periods, 1, definition.metricKey, (value) =>
            indicatorFormatter(definition.metricKey, value),
          ),
          q4: period(periods, 2, definition.metricKey, (value) =>
            indicatorFormatter(definition.metricKey, value),
          ),
          q3: period(periods, 3, definition.metricKey, (value) =>
            indicatorFormatter(definition.metricKey, value),
          ),
          prior: period(periods, 4, definition.metricKey, (value) =>
            indicatorFormatter(definition.metricKey, value),
          ),
        }))
      : [];
  const indicatorRows = buildIndicatorRows(report.historicalPeriods);
  type HighlightSection = "availability" | "delivery" | "construction";
  const presentProperties = (
    items: IndustrialMarketReport["availabilities"],
    section: HighlightSection,
  ) => {
    const presented = items.slice(0, 3).map((item) => {
      const fields =
        section === "availability"
          ? [item.propertyType || item.type, item.availabilityType]
          : section === "delivery"
            ? [
                item.developmentType || item.type,
                item.developer || item.sponsor,
              ]
            : [
                item.constructionType || item.type,
                item.developer || item.sponsor,
              ];
      return {
        ...item,
        state: item.image ? "record" : "image-unavailable",
        detail: [
          `${item.sizeSf.toLocaleString("en-US")} SF`,
          ...fields.filter(Boolean),
        ].join(" - "),
      };
    });
    while (presented.length < 3)
      presented.push({
        address: "",
        sizeSf: 0,
        type: "",
        sponsor: "",
        image: "",
        state: "none",
        detail: "",
      });
    return presented;
  };
  const transactionRows = (
    items: IndustrialMarketReport["leasing"] | IndustrialMarketReport["sales"],
    kind: "lease" | "sale",
  ) => {
    const rows = items.slice(0, 3).map((item) =>
      kind === "lease"
        ? {
            party:
              (item as IndustrialMarketReport["leasing"][number])
                .tenantDisplayName ??
              (item as IndustrialMarketReport["leasing"][number]).tenant,
            amount: `${integer((item as IndustrialMarketReport["leasing"][number]).sizeSf)} SF`,
            address: item.address,
            type: (item as IndustrialMarketReport["leasing"][number]).leaseType,
            isLeeDeal:
              (item as IndustrialMarketReport["leasing"][number]).isLeeDeal ===
              true,
          }
        : {
            party: (item as IndustrialMarketReport["sales"][number]).buyer,
            amount: money(
              (item as IndustrialMarketReport["sales"][number]).price,
            ),
            address: item.address,
            type:
              (item as IndustrialMarketReport["sales"][number]).saleType ===
              "Included"
                ? "Sale type not published"
                : (item as IndustrialMarketReport["sales"][number]).saleType,
            isLeeDeal:
              (item as IndustrialMarketReport["sales"][number]).isLeeDeal ===
              true,
          },
    );
    while (rows.length < 3)
      rows.push({
        party: "-",
        amount: "-",
        address: "-",
        type: "-",
        isLeeDeal: false,
      });
    return rows;
  };
  const submarketDetails = report.submarketDetails.map((detail) => {
    const identity = resolveChicagoSubmarket(
      detail.id ?? detail.canonicalName ?? detail.name,
    );
    return {
      ...detail,
      id: identity?.id ?? detail.id,
      canonicalName:
        identity?.canonicalName ?? detail.canonicalName ?? detail.name,
      displayName: identity?.displayName ?? detail.displayName ?? detail.name,
      mapAssetUrl: resolveMarketMapAsset(identity?.id ?? ""),
      indicatorRows: buildIndicatorRows(detail.historicalPeriods),
      topLeaseRows: transactionRows(detail.leasing, "lease"),
      topSaleRows: transactionRows(detail.sales, "sale"),
      topAvailabilities: presentProperties(
        detail.availabilities,
        "availability",
      ),
      topDeliveries: presentProperties(detail.deliveries, "delivery"),
      topConstruction: presentProperties(detail.construction, "construction"),
    };
  });
  const clientFacing = {
    overallMarket: report.overallMarket,
    submarkets: report.submarkets,
    historicalPeriods: report.historicalPeriods,
    leasing: report.leasing,
    sales: report.sales,
    availabilities: report.availabilities,
    deliveries: report.deliveries,
    construction: report.construction,
    submarketDetails,
  };
  assertNoClientFacingSalesforceIds(clientFacing);
  const presentation = {
    ...report,
    reportDisplay,
    overallMarketMapAssetUrl: resolveMarketMapAsset("overall-market"),
    overallMarket: { ...report.overallMarket },
    periods: report.historicalPeriods,
    sourceNotes: report.provenance,
    submarketTableRows,
    indicatorRows,
    topLeases: report.leasing,
    topSales: report.sales,
    topLeaseRows: transactionRows(report.leasing, "lease"),
    topSaleRows: transactionRows(report.sales, "sale"),
    topAvailabilities: presentProperties(report.availabilities, "availability"),
    topDeliveries: presentProperties(report.deliveries, "delivery"),
    topConstruction: presentProperties(report.construction, "construction"),
    submarketDetails,
  };
  const safePresentation = sanitizeSalesforceClientPayload(presentation);
  assertNoClientFacingSalesforceIds(safePresentation);
  return safePresentation;
}
