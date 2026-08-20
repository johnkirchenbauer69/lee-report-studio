import type { SalesforceRecord } from "../salesforce/SalesforceClient.ts";

const HUNDRED_SCALE_FIELDS = new Set([
  "Total_Available_Percent__c",
  "Delivered_Percent_of_Inventory__c",
  "Direct_Available_Percent__c",
  "Direct_Vacant_Percent__c",
  "Sublet_Available_Percent__c",
  "Sublet_Vacant_Percent__c",
  "Total_Vacant_Percent__c",
  "Under_Construction_Percent_of_Inventory__c",
  "Occupancy_Percent__c",
]);
const THOUSAND_SCALE_FIELDS = new Set([
  "Direct_Vacant_Available_Percent__c",
  "Sublet_Vacant_Available_Percent__c",
  "Total_Vacant_Available_Percent__c",
]);

export function normalizeSalesforcePercent(field: string, input: unknown) {
  if (input === null || input === undefined || input === "") return input;
  const value = Number(input);
  if (!Number.isFinite(value)) return input;
  if (Math.abs(value) < 1) return value;
  if (THOUSAND_SCALE_FIELDS.has(field)) return value / 1000;
  if (HUNDRED_SCALE_FIELDS.has(field)) return value / 100;
  return value;
}

export function normalizeSalesforceMarketDataRecord<T extends SalesforceRecord>(
  record: T,
): T {
  const normalized: SalesforceRecord = { ...record };
  for (const field of [...HUNDRED_SCALE_FIELDS, ...THOUSAND_SCALE_FIELDS]) {
    if (field in normalized)
      normalized[field] = normalizeSalesforcePercent(field, normalized[field]);
  }
  return normalized as T;
}

export interface QuarterBounds {
  label: string;
  start: string;
  end: string;
  year: number;
  quarter: number;
}
export function normalizeQuarterBounds(input: string): QuarterBounds {
  const value = input.trim();
  const yearFirst = value.match(/^(\d{4})\s*Q([1-4])$/i);
  const quarterFirst = value.match(/^Q([1-4])\s*(\d{4})$/i);
  const match =
    yearFirst ??
    (quarterFirst ? [quarterFirst[0], quarterFirst[2], quarterFirst[1]] : null);
  if (!match)
    throw new Error(`Unsupported Salesforce quarter label: ${input}.`);
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const startMonth = (quarter - 1) * 3;
  const lastDay = new Date(Date.UTC(year, startMonth + 3, 0)).getUTCDate();
  return {
    label: `${year} Q${quarter}`,
    start: `${year}-${String(startMonth + 1).padStart(2, "0")}-01`,
    end: `${year}-${String(startMonth + 3).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    year,
    quarter,
  };
}

export function propertyDataQuarterPredicate(input: string) {
  const bounds = normalizeQuarterBounds(input);
  return `(Quarter__c = '${bounds.label}' OR (Quarter__c = 'Q${bounds.quarter}' AND Period_End__c >= ${bounds.start} AND Period_End__c <= ${bounds.end}))`;
}

export type AvailabilitySizeBucket =
  "20-75k SF" | "75-150k SF" | "150-250k SF" | "250-500k SF" | "500k SF+";
export function availabilitySizeBucket(
  value: number,
): AvailabilitySizeBucket | undefined {
  if (value < 20_000) return undefined;
  if (value < 75_000) return "20-75k SF";
  if (value < 150_000) return "75-150k SF";
  if (value < 250_000) return "150-250k SF";
  if (value < 500_000) return "250-500k SF";
  return "500k SF+";
}
