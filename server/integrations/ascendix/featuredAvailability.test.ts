import { describe, expect, it } from "vitest";
import { selectFeaturedAvailability } from "./featuredAvailability.ts";
import { mapHistoricalContributors, selectContributorFinalists } from "./contributors.ts";

const scope = { period: "2026 Q3", submarket: "Central DuPage" };
const base = {
  Id: "featured-1", Quarter_Label__c: scope.period, Submarket__c: scope.submarket,
  Active_In_Run__c: true, Included_In_Report__c: true,
  Contributor_Category__c: "Featured Lee Availability", Is_Lee_Availability__c: true,
  Property__c: "property-1", Availability__c: "availability-1", Rank__c: 1,
  Available_SF__c: 15900, Address__c: "832 Industrial Dr", Run_ID__c: "frozen-run",
};
describe("featured availability snapshot selection", () => {
  it.each([
    { Quarter_Label__c: "2026 Q4" }, { Submarket__c: "West Cook" },
    { Active_In_Run__c: false }, { Included_In_Report__c: false },
    { Contributor_Category__c: "Largest Availability" }, { Is_Lee_Availability__c: false },
    { Property__c: null }, { Availability__c: null }, { Rank__c: null },
    { Available_SF__c: null },
  ])("rejects ineligible records: %j", (override) => {
    expect(selectFeaturedAvailability([{ ...base, ...override }], scope).status).toBe("empty");
  });
  it("respects published rank rather than live size or response order", () => {
    const other = { ...base, Id: "featured-2", Rank__c: 2, Available_SF__c: 999999 };
    const result = selectFeaturedAvailability([other, base], scope);
    expect(result.status === "selected" && result.record.Id).toBe(base.Id);
  });
  it("reports duplicate priority rather than selecting an arbitrary property", () => {
    expect(selectFeaturedAvailability([base, { ...base, Id: "duplicate" }], scope).status).toBe("ambiguous");
  });
  it("enriches featured finalists and preserves historical size in the snapshot", async () => {
    const row = { ...base, Availability__r: { ascendix__AvailableArea__c: 999999 } };
    expect(selectContributorFinalists([row]).map(x => x.Id)).toContain(base.Id);
    const mapped = await mapHistoricalContributors([row], undefined, scope);
    expect(mapped.featuredAvailability).toMatchObject({
      status: "selected", source: { contributorId: base.Id, propertyId: base.Property__c, period: scope.period },
      property: { sizeSf: 15900 },
    });
    expect((await mapHistoricalContributors([row])).featuredAvailability).toBeUndefined();
  });
});
