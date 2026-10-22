import { describe, expect, it } from "vitest";
import { selectFeaturedDeal } from "./featuredDeal";
import { mapHistoricalContributors } from "./contributors";

const scope = { period: "2026 Q3", submarket: "Central DuPage" };
const property = { ascendix__Street__c: "2400 Internationale Pkwy", ascendix__City__c: "Woodridge", State__c: "IL" };
const lease = { Id: "lease-1", Lee_Deal__c: true, Off_Market_Date__c: "2026-08-07", ascendix__Size__c: 100000 };
const sale = { Id: "sale-1", Lee_Deal__c: true, ascendix__SaleDate__c: "2026-07-15", Building_SF__c: 150000 };
const base = { Id: "contributor-1", Quarter_Label__c: "2026 Q3", Submarket__c: "Central DuPage",
  Active_In_Run__c: true, Included_In_Report__c: true, Property__c: "property-1", Property__r: property };
const leaseRow = { ...base, Contributor_Category__c: "Largest New Lease", Lease__c: lease.Id, Lease__r: lease };
const saleRow = { ...base, Id: "contributor-2", Contributor_Category__c: "Largest Sale", Sale__c: sale.Id, Sale__r: sale };

describe("Lee Deal fallback", () => {
  it("compares verified transacted SF across leases and sales", () => {
    expect(selectFeaturedDeal([leaseRow, saleRow], scope)).toMatchObject({ status: "selected", kind: "sale", sizeSf: 150000 });
    expect(selectFeaturedDeal([leaseRow], scope)).toMatchObject({ status: "selected", kind: "lease" });
  });
  it.each([
    { Lease__r: { ...lease, Lee_Deal__c: false } },
    { Lease__r: { ...lease, Off_Market_Date__c: "2026-06-30" } },
    { Lease__r: { ...lease, ascendix__Size__c: null } },
    { Property__r: { ...property, ascendix__City__c: "" } },
    { Active_In_Run__c: false },
    { Included_In_Report__c: false },
  ])("rejects an unverified or out-of-scope transaction: %j", override => {
    expect(selectFeaturedDeal([{ ...leaseRow, ...override }], scope)).toEqual({ status: "empty" });
  });
  it("uses an explicit editorial rank before size when a designated contributor exists", () => {
    const designated = { ...leaseRow, Contributor_Category__c: "Featured Lee Deal", Rank__c: 1 };
    expect(selectFeaturedDeal([designated, saleRow], scope)).toMatchObject({ kind: "lease" });
  });
  it("breaks equal-size ties by immutable contributor identity", () => {
    const equal = { ...saleRow, Sale__r: { ...sale, Building_SF__c: 100000 } };
    expect(selectFeaturedDeal([equal, leaseRow], scope)).toMatchObject({ kind: "lease" });
  });
  it("freezes transaction and property provenance with the selected Lee deal", async () => {
    const mapped = await mapHistoricalContributors([leaseRow], undefined, scope);
    expect(mapped.featuredDeal).toMatchObject({ status: "selected", kind: "lease",
      source: { contributorId: "contributor-1", transactionId: "lease-1", propertyId: "property-1",
        period: "2026 Q3", submarket: "Central DuPage" },
      property: { sizeSf: 100000, address: expect.stringContaining("2400 Internationale Pkwy") } });
  });
});
