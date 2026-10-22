import type { SalesforceRecord } from "../salesforce/SalesforceClient.ts";
import { canonicalChicagoSubmarket } from "./salesforceFieldMap.ts";

export interface FeaturedAvailabilityScope {
  period: string;
  submarket: string;
}

/** Select published contributors only. Live availability values never rank historical cards. */
export function selectFeaturedAvailability(
  rows: SalesforceRecord[],
  scope: FeaturedAvailabilityScope,
) {
  const candidates = rows.filter((row) =>
    row.Quarter_Label__c === scope.period &&
    canonicalChicagoSubmarket(String(row.Submarket__c ?? "")) === scope.submarket &&
    row.Active_In_Run__c === true && row.Included_In_Report__c === true &&
    row.Contributor_Category__c === "Featured Lee Availability" &&
    row.Is_Lee_Availability__c === true &&
    typeof row.Property__c === "string" && Boolean(row.Property__c) &&
    typeof row.Availability__c === "string" && Boolean(row.Availability__c) &&
    Number.isInteger(row.Rank__c) && Number(row.Rank__c) > 0 &&
    typeof row.Available_SF__c === "number" && Number.isFinite(row.Available_SF__c) &&
    row.Available_SF__c > 0,
  ).sort((a, b) => Number(a.Rank__c) - Number(b.Rank__c) || String(a.Id).localeCompare(String(b.Id)));
  if (!candidates.length) return { status: "empty" as const, reason: "No qualifying featured availability." };
  if (candidates[1]?.Rank__c === candidates[0]!.Rank__c)
    return { status: "ambiguous" as const, reason: "Multiple featured contributors share the highest priority rank." };
  return { status: "selected" as const, record: candidates[0]! };
}

/** Executive spread: largest eligible Lee listing in the frozen quarter, regardless of local editorial rank. */
export function selectOverallFeaturedAvailability(rows: SalesforceRecord[], period: string) {
  const candidates = rows.filter(row =>
    row.Quarter_Label__c === period && canonicalChicagoSubmarket(String(row.Submarket__c ?? "")) &&
    row.Active_In_Run__c === true && row.Included_In_Report__c === true &&
    row.Contributor_Category__c === "Featured Lee Availability" && row.Is_Lee_Availability__c === true &&
    typeof row.Property__c === "string" && Boolean(row.Property__c) &&
    typeof row.Availability__c === "string" && Boolean(row.Availability__c) &&
    Number.isInteger(row.Rank__c) && Number(row.Rank__c) > 0 &&
    typeof row.Available_SF__c === "number" && Number.isFinite(row.Available_SF__c) && row.Available_SF__c > 0,
  ).sort((a, b) => Number(b.Available_SF__c) - Number(a.Available_SF__c) || String(a.Id).localeCompare(String(b.Id)));
  return candidates[0] ? { status: "selected" as const, record: candidates[0] } :
    { status: "empty" as const, reason: "No qualifying market-wide Lee availability." };
}
