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
  "netAbsorptionSf",
  "vacancyRate",
  "availabilityRate",
  "askingNetRentPsf",
  "salesVolume",
];

export function buildPresentationModel(report: IndustrialMarketReport) {
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
        `submarkets.${item.name}.netAbsorptionSf`,
        item.netAbsorptionSf,
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
      absorption: integer(totals.netAbsorptionSf),
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
      absorption: extremes.netAbsorptionSf.minimum?.name,
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
      absorption: extremes.netAbsorptionSf.maximum?.name,
      vacancy: extremes.vacancyRate.maximum?.name,
      availability: extremes.availabilityRate.maximum?.name,
      rent: extremes.askingNetRentPsf.maximum?.name,
      sales: extremes.salesVolume.maximum?.name,
    },
  ];
  const period = (
    index: number,
    key: keyof IndustrialMarketReport["historicalPeriods"][number],
    formatter: (value: number) => string,
  ) => formatter(Number(report.historicalPeriods[index]?.[key] ?? 0));
  const indicatorRows = [
    {
      metric: "▼  12 Month Net Absorption (SF)",
      q2: period(0, "netAbsorption12MonthSf", integer),
      q1: period(1, "netAbsorption12MonthSf", integer),
      q4: period(2, "netAbsorption12MonthSf", integer),
      q3: period(3, "netAbsorption12MonthSf", integer),
      prior: period(4, "netAbsorption12MonthSf", integer),
    },
    {
      metric: "▼  Vacancy Rate",
      q2: period(0, "vacancyRate", (value) => percent(value, 2)),
      q1: period(1, "vacancyRate", (value) => percent(value, 2)),
      q4: period(2, "vacancyRate", (value) => percent(value, 2)),
      q3: period(3, "vacancyRate", (value) => percent(value, 2)),
      prior: period(4, "vacancyRate", (value) => percent(value, 2)),
    },
    {
      metric: "▼  Availability Rate",
      q2: period(0, "availabilityRate", (value) => percent(value, 2)),
      q1: period(1, "availabilityRate", (value) => percent(value, 2)),
      q4: period(2, "availabilityRate", (value) => percent(value, 2)),
      q3: period(3, "availabilityRate", (value) => percent(value, 2)),
      prior: period(4, "availabilityRate", (value) => percent(value, 2)),
    },
    {
      metric: "▲  Under Construction (SF)",
      q2: period(0, "underConstructionSf", integer),
      q1: period(1, "underConstructionSf", integer),
      q4: period(2, "underConstructionSf", integer),
      q3: period(3, "underConstructionSf", integer),
      prior: period(4, "underConstructionSf", integer),
    },
    {
      metric: "▼  Total Leasing Activity (SF)",
      q2: period(0, "leasingActivitySf", integer),
      q1: period(1, "leasingActivitySf", integer),
      q4: period(2, "leasingActivitySf", integer),
      q3: period(3, "leasingActivitySf", integer),
      prior: period(4, "leasingActivitySf", integer),
    },
  ];
  return {
    ...report,
    overallMarket: { ...totals, narrative: report.overallMarket.narrative },
    periods: report.historicalPeriods,
    sourceNotes: report.provenance,
    submarketTableRows,
    indicatorRows,
    topLeases: report.leasing,
    topSales: report.sales,
    topLeaseRows: report.leasing.map((item) => ({
      party: item.tenant,
      amount: `${integer(item.sizeSf)} SF`,
      address: item.address,
      type: item.leaseType,
    })),
    topSaleRows: report.sales.map((item) => ({
      party: item.buyer,
      amount: money(item.price),
      address: item.address,
      type: item.saleType,
    })),
    topAvailabilities: report.availabilities,
    topDeliveries: report.deliveries,
    topConstruction: report.construction,
  };
}
