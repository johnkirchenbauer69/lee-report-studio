import {
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
// null (an authoritative-null Overall rent) renders the report's existing
// unavailable state ("—"), never $0.
const rent = (value: number | null) =>
  formatReportValue(value, { type: "currency", decimals: 2 });
const sizeSfDisplay = (value: number) =>
  formatReportValue(value, { type: "square-feet" });
const pricePerSfDisplay = (value: number) =>
  formatReportValue(value, { type: "currency-per-square-foot" });
/**
 * Canonical "SIZE (SF) / PRICE ($/SF)" combined display value for the Top
 * Sales table. Never recalculates Price/SF here -- both inputs are already
 * normalized (and, when needed, derived) in the data layer
 * (`server/integrations/ascendix/contributors.ts`); this only formats and
 * joins whatever the report payload already contains.
 */
const saleSizePricePerSf = (
  sizeSf: number | undefined,
  pricePerSf: number | null | undefined,
): string => {
  const hasSize = typeof sizeSf === "number" && sizeSf > 0;
  const hasPricePerSf = typeof pricePerSf === "number";
  if (hasSize && hasPricePerSf)
    return `${sizeSfDisplay(sizeSf)} / ${pricePerSfDisplay(pricePerSf)}`;
  if (hasSize) return sizeSfDisplay(sizeSf);
  if (hasPricePerSf) return pricePerSfDisplay(pricePerSf);
  return "-";
};
/**
 * Top Leases/Top Sales-only address formatting: drops a trailing ZIP (or
 * ZIP+4) so the row reads "<street>, <city>, <state>" -- city and state are
 * always preserved. This only reformats the display string produced for
 * these two transaction tables; the canonical `address` field elsewhere in
 * the report (property cards, provenance, exports) is untouched.
 */
const addressWithoutZip = (address: string): string =>
  address.replace(/\s+\d{5}(-\d{4})?\s*$/, "").trim();
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

export function buildPresentationModel(report: IndustrialMarketReport, options?: { savedMetricsOnly?: boolean }) {
  const periodMatch = report.report.period.match(/^(\d{4})\s+(Q[1-4])$/i);
  const reportDisplay = {
    period: periodMatch
      ? `${periodMatch[2].toUpperCase()} ${periodMatch[1]}`
      : report.report.period,
    year: periodMatch?.[1] ?? report.report.period,
    quarter: periodMatch?.[2].toUpperCase() ?? report.report.period,
  };
  // The Market Totals row is the report's Overall Market source object
  // (for full Chicago scope, the first-class Overall Market Market_Data__c
  // row). It is never independently recomputed from the submarkets: no
  // summed inventory, no inventory-weighted percentages or rents.
  const totals = report.overallMarket;
  const extremes = Object.fromEntries(
    metricKeys.map((key) => [
      key,
      options?.savedMetricsOnly ? {} : calculateMetricExtremes(report.submarkets, key),
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
      inventory: integer(
        resolvePresentationValue(
          report,
          "overallMarket.inventorySf",
          totals.inventorySf,
        ),
      ),
      delivered: integer(
        resolvePresentationValue(
          report,
          "overallMarket.deliveredSf",
          totals.deliveredSf,
        ),
      ),
      underConstruction: integer(
        resolvePresentationValue(
          report,
          "overallMarket.underConstructionSf",
          totals.underConstructionSf,
        ),
      ),
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
      vacancy: percent(
        resolvePresentationValue(
          report,
          "overallMarket.vacancyRate",
          totals.vacancyRate,
        ),
      ),
      availability: percent(
        resolvePresentationValue(
          report,
          "overallMarket.availabilityRate",
          totals.availabilityRate,
        ),
      ),
      rent: rent(
        resolvePresentationValue(
          report,
          "overallMarket.askingNetRentPsf",
          totals.askingNetRentPsf,
        ),
      ),
      sales: money(
        resolvePresentationValue(
          report,
          "overallMarket.salesVolume",
          totals.salesVolume,
        ),
      ),
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
                // Card UI consumes only the governed displayParty; the raw
                // tenant/owner/developer fields never drive presentation
                // directly (see resolveDisplayParty in contributors.ts).
                item.displayParty || item.developer || item.sponsor,
              ]
            : [
                item.constructionType || item.type,
                item.displayParty || item.developer || item.sponsor,
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
            address: addressWithoutZip(item.address),
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
            address: addressWithoutZip(item.address),
            type:
              (item as IndustrialMarketReport["sales"][number]).saleType ===
              "Included"
                ? "Sale type not published"
                : (item as IndustrialMarketReport["sales"][number]).saleType,
            isLeeDeal:
              (item as IndustrialMarketReport["sales"][number]).isLeeDeal ===
              true,
            sizePricePerSf: saleSizePricePerSf(
              (item as IndustrialMarketReport["sales"][number]).sizeSf,
              (item as IndustrialMarketReport["sales"][number]).pricePerSf,
            ),
          },
    );
    while (rows.length < 3)
      rows.push({
        party: "-",
        amount: "-",
        address: "-",
        type: "-",
        isLeeDeal: false,
        sizePricePerSf: "-",
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
