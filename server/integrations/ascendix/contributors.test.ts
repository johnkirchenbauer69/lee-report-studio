import { describe, expect, it } from "vitest";
import {
  contributorSection,
  mapHistoricalContributors,
  rankContributors,
} from "./contributors.ts";

const row = (overrides: Record<string, unknown>) => ({
  Id: String(overrides.Id ?? Math.random()),
  Active_In_Run__c: true,
  Included_In_Report__c: true,
  ...overrides,
});
describe("historical contributors", () => {
  it("maps exact categories and explicit legacy variations", () => {
    expect(contributorSection("Largest New Lease")).toBe("leasing");
    expect(contributorSection("largest-uc legacy")).toBe("construction");
  });
  it("filters inactive/excluded rows and ranks sort then metric then rank", () => {
    const rows = [
      row({
        Id: "metric",
        Contributor_Category__c: "Lease",
        Metric_Value__c: 20,
        Rank__c: 2,
      }),
      row({
        Id: "sort",
        Contributor_Category__c: "Lease",
        Sort_Value__c: 30,
        Rank__c: 3,
      }),
      row({
        Id: "inactive",
        Contributor_Category__c: "Lease",
        Sort_Value__c: 99,
        Active_In_Run__c: false,
      }),
    ];
    expect(rankContributors(rows, "leasing").map((item) => item.Id)).toEqual([
      "sort",
      "metric",
    ]);
  });
  it("maps all production card families with relationship fallbacks", () => {
    const common = {
      Rank__c: 1,
      Sort_Value__c: 100,
      Property__r: {
        Full_Address__c: "1 Main",
        ascendix__PropertySubType__c: "Warehouse",
        ascendix__ExpansionType__c: "Speculative",
        ascendix__PrimaryImage__c: "/img.png",
      },
    };
    const mapped = mapHistoricalContributors([
      row({
        ...common,
        Id: "l",
        Contributor_Category__c: "Lease",
        Lease_SF__c: 100,
        Tenant_Name__c: "Tenant",
        Address__c: "1 Main",
        Deal_Type__c: "New",
      }),
      row({
        ...common,
        Id: "s",
        Contributor_Category__c: "Sale",
        Sale_Price__c: 100,
        Buyer_Name__c: "Buyer",
        Address__c: "1 Main",
        Sale_Type__c: "Investment",
      }),
      row({
        ...common,
        Id: "a",
        Contributor_Category__c: "Availability",
        Available_SF__c: 100,
        Address__c: "1 Main",
        Property_Type__c: "Warehouse",
        Availability__r: {
          ascendix__Property__r: { ascendix__PrimaryImage__c: "/img.png" },
        },
      }),
      row({
        ...common,
        Id: "d",
        Contributor_Category__c: "Delivery",
        Delivered_SF__c: 100,
      }),
      row({
        ...common,
        Id: "c",
        Contributor_Category__c: "Under Construction",
        Under_Construction_SF__c: 100,
      }),
    ]);
    expect([
      mapped.leasing.length,
      mapped.sales.length,
      mapped.availabilities.length,
      mapped.deliveries.length,
      mapped.construction.length,
    ]).toEqual([1, 1, 1, 1, 1]);
    expect(mapped.provenance).toHaveLength(5);
  });
});
