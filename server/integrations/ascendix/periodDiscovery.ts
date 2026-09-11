import type { ReportPeriodOption } from "../../../src/report-engine/schema/reportPeriods.ts";
import {
  CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS,
  canonicalChicagoSubmarket,
  salesforceFieldMap as mapping,
} from "./salesforceFieldMap.ts";
import type { SalesforceRecord } from "../salesforce/SalesforceClient.ts";
import { selectQuery, soqlLiteralList } from "../salesforce/soql.ts";
import {
  normalizeQuarterBounds,
  normalizeSalesforcePercent,
} from "./salesforceNormalization.ts";

const api = (entry: { apiName: string }) => entry.apiName;
const md = mapping.marketData;

/** Fields required by the existing Market_Data-backed report metric mapper. */
export const reportPeriodMetricFields = [
  md.inventorySf,
  md.deliveredSf,
  md.underConstructionSf,
  md.underConstructionAvailableSf,
  md.quarterlyNetAbsorptionSf,
  md.vacancyRate,
  md.availabilityRate,
  md.askingNetRentPsf,
  md.salesVolume,
] as const;

// Asking rent is intentionally omitted: the existing report contract uses a
// zero value plus a validation warning when a submarket has no published rent.
const requiredReportPeriodMetricFields = reportPeriodMetricFields.filter(
  (field) => field !== md.askingNetRentPsf,
);

export function reportPeriodDiscoveryQuery() {
  const accepted = soqlLiteralList(
    CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS,
    "Chicago submarkets",
  );
  return selectQuery(
    api(md.object),
    [
      md.periodEnd,
      md.period,
      md.submarket,
      md.submarketCode,
      ...reportPeriodMetricFields,
    ].map(api),
    `${api(md.periodEnd)} != NULL AND ${api(md.period)} != NULL AND ${api(md.submarket)} IN ${accepted}`,
    ` ORDER BY ${api(md.periodEnd)} DESC LIMIT 360`,
  );
}

const recordText = (record: SalesforceRecord, field: { apiName: string }) =>
  String(record[field.apiName] ?? "").trim();

function hasRequiredMetrics(record: SalesforceRecord) {
  return requiredReportPeriodMetricFields.every((field) => {
    const raw = record[field.apiName];
    if (raw === null || raw === undefined || raw === "") return false;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return false;
    if (field === md.vacancyRate || field === md.availabilityRate) {
      const rate = normalizeSalesforcePercent(field.apiName, numeric);
      return typeof rate === "number" && rate >= 0 && rate <= 1;
    }
    if (field !== md.quarterlyNetAbsorptionSf && numeric < 0) return false;
    return true;
  });
}

/**
 * Converts raw Market_Data rows into complete, unique quarter options.
 * A future period is intentionally treated exactly like a past period: data
 * presence and the governed 18-submarket contract determine availability.
 */
export function reportablePeriodsFromMarketData(
  rows: SalesforceRecord[],
  limit = 8,
): ReportPeriodOption[] {
  const groups = new Map<
    string,
    { label: string; periodEnd: string; submarkets: Set<string> }
  >();
  for (const row of rows) {
    const periodEnd = recordText(row, md.periodEnd).slice(0, 10);
    const sourceLabel = recordText(row, md.period);
    if (!periodEnd || !sourceLabel || !hasRequiredMetrics(row)) continue;
    let label: string;
    try {
      const bounds = normalizeQuarterBounds(sourceLabel);
      if (bounds.end !== periodEnd) continue;
      label = bounds.label;
    } catch {
      continue;
    }
    const canonical =
      canonicalChicagoSubmarket(recordText(row, md.submarket)) ??
      canonicalChicagoSubmarket(recordText(row, md.submarketCode));
    if (!canonical) continue;
    const key = `${periodEnd}|${label}`;
    const group = groups.get(key) ?? {
      label,
      periodEnd,
      submarkets: new Set<string>(),
    };
    group.submarkets.add(canonical);
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter(
      ({ submarkets }) =>
        submarkets.size === CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS.length,
    )
    .sort((left, right) => right.periodEnd.localeCompare(left.periodEnd))
    .slice(0, limit)
    .map(({ label, periodEnd, submarkets }) => ({
      label,
      periodEnd,
      submarketCount: submarkets.size,
    }));
}
