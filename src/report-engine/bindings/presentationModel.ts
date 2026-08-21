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
import { looksLikeSalesforceId } from "../../shared/salesforceIds";

export function assertNoClientFacingSalesforceIds(
  value: unknown,
  path = "presentation",
): void {
  if (typeof value === "string" && looksLikeSalesforceId(value))
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
  const buildIndicatorRows = (
    periods: IndustrialMarketReport["historicalPeriods"],
  ) =>
    periods.length
      ? [
          {
            metric: "▼  12 Month Net Absorption (SF)",
            q2: period(periods, 0, "trailing12MonthNetAbsorptionSf", integer),
            q1: period(periods, 1, "trailing12MonthNetAbsorptionSf", integer),
            q4: period(periods, 2, "trailing12MonthNetAbsorptionSf", integer),
            q3: period(periods, 3, "trailing12MonthNetAbsorptionSf", integer),
            prior: period(
              periods,
              4,
              "trailing12MonthNetAbsorptionSf",
              integer,
            ),
          },
          {
            metric: "▼  Vacancy Rate",
            q2: period(periods, 0, "vacancyRate", (value) => percent(value, 2)),
            q1: period(periods, 1, "vacancyRate", (value) => percent(value, 2)),
            q4: period(periods, 2, "vacancyRate", (value) => percent(value, 2)),
            q3: period(periods, 3, "vacancyRate", (value) => percent(value, 2)),
            prior: period(periods, 4, "vacancyRate", (value) =>
              percent(value, 2),
            ),
          },
          {
            metric: "▼  Availability Rate",
            q2: period(periods, 0, "availabilityRate", (value) =>
              percent(value, 2),
            ),
            q1: period(periods, 1, "availabilityRate", (value) =>
              percent(value, 2),
            ),
            q4: period(periods, 2, "availabilityRate", (value) =>
              percent(value, 2),
            ),
            q3: period(periods, 3, "availabilityRate", (value) =>
              percent(value, 2),
            ),
            prior: period(periods, 4, "availabilityRate", (value) =>
              percent(value, 2),
            ),
          },
          {
            metric: "▲  Under Construction (SF)",
            q2: period(periods, 0, "underConstructionSf", integer),
            q1: period(periods, 1, "underConstructionSf", integer),
            q4: period(periods, 2, "underConstructionSf", integer),
            q3: period(periods, 3, "underConstructionSf", integer),
            prior: period(periods, 4, "underConstructionSf", integer),
          },
          {
            metric: "▼  Total Leasing Activity (SF)",
            q2: period(periods, 0, "leasingActivitySf", integer),
            q1: period(periods, 1, "leasingActivitySf", integer),
            q4: period(periods, 2, "leasingActivitySf", integer),
            q3: period(periods, 3, "leasingActivitySf", integer),
            prior: period(periods, 4, "leasingActivitySf", integer),
          },
        ]
      : [];
  const indicatorRows = buildIndicatorRows(report.historicalPeriods);
  const presentProperties = (items: IndustrialMarketReport["availabilities"]) =>
    items.map((item) => ({
      ...item,
      detail: `${item.sizeSf.toLocaleString("en-US")} SF - ${item.type}${item.sponsor ? ` - ${item.sponsor}` : ""}`,
    }));
  const transactionRows = (
    items: IndustrialMarketReport["leasing"] | IndustrialMarketReport["sales"],
    kind: "lease" | "sale",
  ) =>
    items.map((item) =>
      kind === "lease"
        ? {
            party: (item as IndustrialMarketReport["leasing"][number]).tenant,
            amount: `${integer((item as IndustrialMarketReport["leasing"][number]).sizeSf)} SF`,
            address: item.address,
            type: (item as IndustrialMarketReport["leasing"][number]).leaseType,
          }
        : {
            party: (item as IndustrialMarketReport["sales"][number]).buyer,
            amount: money(
              (item as IndustrialMarketReport["sales"][number]).price,
            ),
            address: item.address,
            type: (item as IndustrialMarketReport["sales"][number]).saleType,
          },
    );
  const submarketDetails = report.submarketDetails.map((detail) => ({
    ...detail,
    indicatorRows: buildIndicatorRows(detail.historicalPeriods),
    topLeaseRows: transactionRows(detail.leasing, "lease"),
    topSaleRows: transactionRows(detail.sales, "sale"),
    topAvailabilities: presentProperties(detail.availabilities),
    topDeliveries: presentProperties(detail.deliveries),
    topConstruction: presentProperties(detail.construction),
  }));
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
  return {
    ...report,
    reportDisplay,
    overallMarket: { ...report.overallMarket },
    periods: report.historicalPeriods,
    sourceNotes: report.provenance,
    submarketTableRows,
    indicatorRows,
    topLeases: report.leasing,
    topSales: report.sales,
    topLeaseRows: transactionRows(report.leasing, "lease"),
    topSaleRows: transactionRows(report.sales, "sale"),
    topAvailabilities: presentProperties(report.availabilities),
    topDeliveries: presentProperties(report.deliveries),
    topConstruction: presentProperties(report.construction),
    submarketDetails,
  };
}
