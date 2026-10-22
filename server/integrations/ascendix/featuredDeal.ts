import type { SalesforceRecord } from "../salesforce/SalesforceClient.ts";
import { canonicalChicagoSubmarket } from "./salesforceFieldMap.ts";

export interface FeaturedDealScope { period: string; submarket?: string }
export type SelectedDeal = { status: "selected"; kind: "lease" | "sale"; record: SalesforceRecord; sizeSf: number; reason: string };

const value = (row: SalesforceRecord, path: string): unknown => path.split(".").reduce<unknown>((item, key) =>
  item && typeof item === "object" ? (item as Record<string, unknown>)[key] : undefined, row);
const positive = (item: unknown): item is number => typeof item === "number" && Number.isFinite(item) && item > 0;
const quarterDate = (date: unknown, period: string) => {
  const match = /^(\d{4}) Q([1-4])$/.exec(period);
  if (!match || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(date) &&
    parsed.getUTCFullYear() === Number(match[1]) && Math.floor(parsed.getUTCMonth() / 3) + 1 === Number(match[2]);
};

/** Historical contributor scope plus linked transaction proof; neither Top status nor a party name proves Lee involvement. */
export function selectFeaturedDeal(rows: SalesforceRecord[], scope: FeaturedDealScope): SelectedDeal | { status: "empty" } {
  const candidates = rows.flatMap((row): SelectedDeal[] => {
    if (row.Quarter_Label__c !== scope.period || row.Active_In_Run__c !== true || row.Included_In_Report__c !== true ||
      (scope.submarket && canonicalChicagoSubmarket(String(row.Submarket__c ?? "")) !== scope.submarket) ||
      !row.Property__c || !row.Id) return [];
    const category = String(row.Contributor_Category__c ?? "");
    const designated = category === "Featured Lee Deal";
    const lease = (/lease/i.test(category) || designated) && Boolean(row.Lease__c) && !row.Sale__c;
    const sale = (/sale/i.test(category) || designated) && Boolean(row.Sale__c) && !row.Lease__c;
    if (!lease && !sale) return [];
    const kind = lease ? "lease" : "sale";
    const transaction = value(row, lease ? "Lease__r" : "Sale__r") as SalesforceRecord | undefined;
    if (transaction?.Lee_Deal__c !== true || transaction.Id !== (lease ? row.Lease__c : row.Sale__c)) return [];
    const date = lease ? transaction.Off_Market_Date__c : transaction.ascendix__SaleDate__c;
    if (!quarterDate(date, scope.period)) return [];
    const sizeSf = lease ? transaction.ascendix__Size__c : transaction.Building_SF__c;
    if (!positive(sizeSf)) return [];
    const property = row.Property__r as SalesforceRecord | undefined;
    if (!property || typeof property.ascendix__Street__c !== "string" || !property.ascendix__Street__c.trim() ||
      typeof property.ascendix__City__c !== "string" || !property.ascendix__City__c.trim() ||
      typeof property.State__c !== "string" || !property.State__c.trim()) return [];
    return [{ status: "selected", kind, record: row, sizeSf, reason: "Verified Lee checkbox, dated linked transaction, canonical transacted SF" }];
  });
  candidates.sort((a, b) => {
    const designatedA = a.record.Contributor_Category__c === "Featured Lee Deal" ? 0 : 1;
    const designatedB = b.record.Contributor_Category__c === "Featured Lee Deal" ? 0 : 1;
    if (designatedA !== designatedB) return designatedA - designatedB;
    if (!designatedA) {
      const rankA = Number(a.record.Rank__c) || Number.MAX_SAFE_INTEGER;
      const rankB = Number(b.record.Rank__c) || Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
    }
    return b.sizeSf - a.sizeSf || String(a.record.Id).localeCompare(String(b.record.Id));
  });
  return candidates[0] ?? { status: "empty" };
}
