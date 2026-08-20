import { describe, expect, it } from "vitest";
import { historicalLeaseQuery, historicalSaleQuery } from "./sourceQueries.ts";
describe("verified direct source query contracts", () => {
  it("uses Ascendix Lease and Off_Market_Date quarter bounds", () => {
    const query = historicalLeaseQuery("2026 Q2", "O'Hare");
    expect(query).toContain("FROM ascendix__Lease__c");
    expect(query).toContain("Off_Market_Date__c >= 2026-04-01");
    expect(query).toContain("Off_Market_Date__c <= 2026-06-30");
  });
  it("prefers the Sale date and exposes an explicit fallback", () => {
    expect(historicalSaleQuery("2026Q2")).toContain(
      "ascendix__SaleDate__c >= 2026-04-01",
    );
    expect(historicalSaleQuery("2026Q2", undefined, true)).toContain(
      "Off_Market_Date__c >= 2026-04-01",
    );
  });
});
