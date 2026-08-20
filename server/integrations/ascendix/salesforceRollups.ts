import type {
  HistoricalMarketPeriod,
  MarketMetrics,
  SubmarketMetrics,
} from "../../../src/report-engine/schema/industrialMarketReport.ts";
import type { SalesforceRecord } from "../salesforce/SalesforceClient.ts";
import { salesforceFieldMap as mapping } from "./salesforceFieldMap.ts";

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
    netAbsorptionSf: number;
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
    netAbsorptionSf: sum(rows, pd.netAbsorptionSf),
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
      netAbsorptionSf: facts.netAbsorptionSf,
      vacancyRate: inventorySf > 0 ? vacantSf / inventorySf : 0,
      availabilityRate: inventorySf > 0 ? availableSf / inventorySf : 0,
      askingNetRentPsf,
      salesVolume: facts.salesVolume,
    },
  };
}

export function aggregateHistoricalMarketPeriod(
  period: string,
  rows: SalesforceRecord[],
): HistoricalMarketPeriod {
  const md = mapping.marketData;
  const inventory = sum(rows, md.inventorySf);
  return {
    period,
    netAbsorption12MonthSf: sum(rows, md.netAbsorptionSf),
    vacancyRate: inventory > 0 ? sum(rows, md.totalVacantSf) / inventory : 0,
    availabilityRate:
      inventory > 0 ? sum(rows, md.totalAvailableSf) / inventory : 0,
    underConstructionSf: sum(rows, md.underConstructionSf),
    leasingActivitySf: sum(rows, md.leasingActivitySf),
  };
}
