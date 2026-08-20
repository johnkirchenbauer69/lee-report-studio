import type {
  HistoricalMarketPeriod,
  MarketMetrics,
  SubmarketMetrics,
} from "../../../src/report-engine/schema/industrialMarketReport.ts";
import type { SalesforceRecord } from "../salesforce/SalesforceClient.ts";
import { salesforceFieldMap as mapping } from "./salesforceFieldMap.ts";
import { normalizeQuarterBounds } from "./salesforceNormalization.ts";

const numeric = (record: SalesforceRecord, field: { apiName: string }) => {
  const value = record[field.apiName];
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    throw new Error(`Salesforce returned an invalid ${field.apiName}.`);
  return parsed;
};
const sum = (rows: SalesforceRecord[], field: { apiName: string }) =>
  rows.reduce((total, row) => total + numeric(row, field), 0);
export const verifiedSpeculativeShare = (
  underConstructionSf: number,
  underConstructionAvailableSf: number,
) =>
  underConstructionSf > 0
    ? Math.min(
        1,
        Math.max(0, underConstructionAvailableSf / underConstructionSf),
      )
    : 0;

export interface PropertyDataRollup {
  metrics: MarketMetrics;
  facts: {
    matchedProperties: number;
    inventorySf: number;
    vacantSf: number;
    availableSf: number;
    quarterlyNetAbsorptionSf: number;
    leasingActivitySf: number;
    deliveredSf: number;
    underConstructionSf: number;
    underConstructionAvailableSf: number;
    salesVolume: number;
    unlinkedMarketDataRows: number;
  };
}

export function rollupPropertyData(
  rows: SalesforceRecord[],
  marketDataSubmarkets: SubmarketMetrics[],
): PropertyDataRollup {
  const pd = mapping.propertyData;
  const inventorySf = sum(rows, pd.inventorySf);
  const vacantSf = sum(rows, pd.vacantSf);
  const availableSf = sum(rows, pd.availableSf);
  const underConstructionSf = sum(rows, pd.underConstructionSf);
  const underConstructionAvailableSf = sum(
    rows,
    pd.underConstructionAvailableSf,
  );
  const rentDenominator = marketDataSubmarkets.reduce(
    (total, row) => total + row.inventorySf,
    0,
  );
  const askingNetRentPsf =
    rentDenominator > 0
      ? marketDataSubmarkets.reduce(
          (total, row) => total + row.askingNetRentPsf * row.inventorySf,
          0,
        ) / rentDenominator
      : 0;
  const facts = {
    matchedProperties: rows.length,
    inventorySf,
    vacantSf,
    availableSf,
    quarterlyNetAbsorptionSf: sum(rows, pd.quarterlyNetAbsorptionSf),
    leasingActivitySf: sum(rows, pd.leasingActivitySf),
    deliveredSf: sum(rows, pd.deliveredSf),
    underConstructionSf,
    underConstructionAvailableSf,
    salesVolume: sum(rows, pd.salesVolume),
    unlinkedMarketDataRows: rows.filter((row) => !row[pd.marketDataId.apiName])
      .length,
  };
  return {
    facts,
    metrics: {
      inventorySf,
      deliveredSf: facts.deliveredSf,
      underConstructionSf,
      speculativeShare: verifiedSpeculativeShare(
        underConstructionSf,
        underConstructionAvailableSf,
      ),
      quarterlyNetAbsorptionSf: facts.quarterlyNetAbsorptionSf,
      vacancyRate: inventorySf > 0 ? vacantSf / inventorySf : 0,
      availabilityRate: inventorySf > 0 ? availableSf / inventorySf : 0,
      askingNetRentPsf,
      salesVolume: facts.salesVolume,
    },
  };
}

export type QuarterlyMarketPeriod = Omit<
  HistoricalMarketPeriod,
  "trailing12MonthNetAbsorptionSf" | "trailing12MonthNetAbsorptionStatus"
> & {
  sourceIds?: string[];
};

export function aggregateQuarterlyMarketPeriod(
  period: string,
  rows: SalesforceRecord[],
): QuarterlyMarketPeriod {
  const md = mapping.marketData;
  const inventory = sum(rows, md.inventorySf);
  return {
    period: normalizeQuarterBounds(period).label,
    quarterlyNetAbsorptionSf: sum(rows, md.quarterlyNetAbsorptionSf),
    vacancyRate: inventory > 0 ? sum(rows, md.totalVacantSf) / inventory : 0,
    availabilityRate:
      inventory > 0 ? sum(rows, md.totalAvailableSf) / inventory : 0,
    underConstructionSf: sum(rows, md.underConstructionSf),
    leasingActivitySf: sum(rows, md.leasingActivitySf),
    sourceIds: rows.map((row) => String(row.Id)).filter(Boolean),
  };
}

export interface Trailing12MonthNetAbsorptionResult {
  value: number | null;
  status: "complete" | "insufficient_history";
  inputPeriods: string[];
  missingPeriods: string[];
  sourceIds: string[];
}

const quarterOrdinal = (period: string) => {
  const { year, quarter } = normalizeQuarterBounds(period);
  return year * 4 + quarter - 1;
};

const periodFromOrdinal = (ordinal: number) => {
  const year = Math.floor(ordinal / 4);
  const quarter = (ordinal % 4) + 1;
  return `${year} Q${quarter}`;
};

/** Calculates a signed rolling four-quarter sum without zero-filling gaps. */
export function calculateTrailing12MonthNetAbsorption(
  periods: Array<
    Pick<QuarterlyMarketPeriod, "period" | "quarterlyNetAbsorptionSf"> & {
      sourceIds?: string[];
    }
  >,
  targetPeriod: string,
): Trailing12MonthNetAbsorptionResult {
  const normalized = periods
    .map((period) => ({
      ...period,
      period: normalizeQuarterBounds(period.period).label,
      ordinal: quarterOrdinal(period.period),
    }))
    .sort((left, right) => right.ordinal - left.ordinal);
  const byOrdinal = new Map<number, (typeof normalized)[number]>();
  for (const period of normalized) {
    if (byOrdinal.has(period.ordinal))
      throw new Error(
        `Duplicate quarterly net absorption input for ${period.period}.`,
      );
    byOrdinal.set(period.ordinal, period);
  }
  const targetOrdinal = quarterOrdinal(targetPeriod);
  const inputPeriods = [0, 1, 2, 3].map((offset) =>
    periodFromOrdinal(targetOrdinal - offset),
  );
  const inputs = [0, 1, 2, 3].map((offset) =>
    byOrdinal.get(targetOrdinal - offset),
  );
  const missingPeriods = inputPeriods.filter((_, index) => !inputs[index]);
  const sourceIds = inputs.flatMap((input) => input?.sourceIds ?? []);
  if (missingPeriods.length)
    return {
      value: null,
      status: "insufficient_history",
      inputPeriods,
      missingPeriods,
      sourceIds,
    };
  return {
    value: inputs.reduce(
      (total, input) => total + input!.quarterlyNetAbsorptionSf,
      0,
    ),
    status: "complete",
    inputPeriods,
    missingPeriods: [],
    sourceIds,
  };
}
