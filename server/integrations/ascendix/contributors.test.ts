import { describe, expect, it } from "vitest";
import {
  contributorSection,
  mapHistoricalContributors,
  rankContributors,
  scopeHistoricalContributors,
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
    expect(contributorSection("Featured Lee Availability")).toBe(
      "featuredListings",
    );
    expect(contributorSection("Highest Vacancy")).toBe("highestVacancy");
    expect(contributorSection("Largest Negative Net Absorption")).toBe(
      "negativeAbsorption",
    );
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
  it("maps all production card families with relationship fallbacks", async () => {
    const common = {
      Rank__c: 1,
      Sort_Value__c: 100,
      Property__r: {
        ascendix__PropertySubType__c: "Warehouse",
        ascendix__ExpansionType__c: "Speculative",
        ascendix__PrimaryImage__c: "/img.png",
      },
    };
    const mapped = await mapHistoricalContributors([
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
    // Non-Salesforce-id image values (already a real URL) pass through unchanged.
    expect(mapped.availabilities[0].image).toBe("/img.png");
    expect(mapped.imageWarnings).toHaveLength(0);
  });

  it("prefers readable sponsor fields and never leaks an Account id", async () => {
    const base = {
      Contributor_Category__c: "Largest Availability",
      Available_SF__c: 100,
      Address__c: "1 Main",
      Property_Type__c: "Industrial",
    };
    const unsafe = await mapHistoricalContributors([
      row({
        ...base,
        Id: "unsafe",
        Availability__r: { Listing_Broker_Company__c: "001al00000dS4qYAAS" },
      }),
    ]);
    expect(unsafe.availabilities[0].sponsor).toBe("");
    const resolved = await mapHistoricalContributors([
      row({
        ...base,
        Id: "resolved",
        Availability__r: { Listing_Broker_Company__c: "001al00000dS4qYAAS" },
        Sponsor_Account__r: { Name: "Readable Sponsor" },
      }),
    ]);
    expect(resolved.availabilities[0].sponsor).toBe("Readable Sponsor");
  });

  it("never emits a bare Salesforce Attachment id as an image URL, even without a resolver wired up", async () => {
    const mapped = await mapHistoricalContributors([
      row({
        Id: "a",
        Contributor_Category__c: "Largest Availability",
        Available_SF__c: 100,
        Address__c: "1 Main",
        Availability__r: {
          ascendix__Property__r: {
            ascendix__PrimaryImage__c: "00PVy00000AbCdEfGh",
          },
        },
      }),
    ]);
    expect(mapped.availabilities[0].image).toBe("");
    expect(mapped.imageWarnings).toHaveLength(1);
    expect(mapped.imageWarnings[0]).toMatch(/00PVy00000AbCdEfGh/);
  });

  it("resolves a bare Salesforce Attachment id through a supplied image resolver into a Studio asset URL", async () => {
    const mapped = await mapHistoricalContributors(
      [
        row({
          Id: "a",
          Contributor_Category__c: "Largest Availability",
          Available_SF__c: 100,
          Address__c: "1 Main",
          Availability__r: {
            ascendix__Property__r: {
              ascendix__PrimaryImage__c: "00PVy00000AbCdEfGh",
            },
          },
        }),
      ],
      async (value) =>
        value === "00PVy00000AbCdEfGh"
          ? { url: "/api/assets/resolved-asset-id/content" }
          : { url: value },
    );
    expect(mapped.availabilities[0].image).toBe(
      "/api/assets/resolved-asset-id/content",
    );
    expect(mapped.imageWarnings).toHaveLength(0);
  });
  it("scopes standard submarkets, excludes non-report rows, and flags parent conflicts", () => {
    const rows = [
      row({
        Id: "ohare",
        Quarter_Label__c: "2026Q2",
        Submarket__c: "O'Hare",
        Market_Data__c: "md-ohare",
        Market_Data__r: { Quarter_Label__c: "2026 Q2", Submarket__c: "O'Hare" },
      }),
      row({
        Id: "i55",
        Quarter_Label__c: "2026 Q2",
        Submarket__c: "I-55 Corridor",
        Market_Data__c: "md-i55",
      }),
      row({
        Id: "outside",
        Quarter_Label__c: "2026 Q2",
        Submarket__c: "Rockford",
      }),
      row({
        Id: "conflict",
        Quarter_Label__c: "2026 Q2",
        Submarket__c: "O'Hare",
        Market_Data__r: {
          Quarter_Label__c: "2026 Q2",
          Submarket__c: "I-55 Corridor",
        },
      }),
    ];
    const ohare = scopeHistoricalContributors(rows, {
      period: "Q2 2026",
      submarkets: ["O'Hare"],
      marketDataIds: new Map([["O'Hare", "md-ohare"]]),
    });
    expect(ohare.rows.map((item) => item.Id)).toEqual(["ohare"]);
    expect(ohare.issues).toEqual([
      expect.objectContaining({ contributorId: "conflict" }),
    ]);
    expect(
      scopeHistoricalContributors(rows, {
        period: "2026 Q2",
        submarkets: ["I-55 Corridor"],
      }).rows.map((item) => item.Id),
    ).toEqual(["i55"]);
  });
  it("globally ranks pooled Overall Market contributors by Sort_Value", () => {
    const rows = [
      row({
        Id: "ohare",
        Contributor_Category__c: "Largest Availability",
        Submarket__c: "O'Hare",
        Sort_Value__c: 268_635,
      }),
      row({
        Id: "i55",
        Contributor_Category__c: "Largest Availability",
        Submarket__c: "I-55 Corridor",
        Sort_Value__c: 600_000,
      }),
      row({
        Id: "i80",
        Contributor_Category__c: "Largest Availability",
        Submarket__c: "I-80 Corridor/Joliet",
        Sort_Value__c: 1_000_000,
      }),
    ];
    expect(
      rankContributors(rows, "availabilities").map((item) => item.Id),
    ).toEqual(["i80", "i55", "ohare"]);
  });
  it("prefers frozen contributor-native values over mutable enrichment", async () => {
    const mapped = await mapHistoricalContributors([
      row({
        Id: "lease",
        Contributor_Category__c: "Largest New Lease",
        Sort_Value__c: 100,
        Lease_SF__c: 100,
        Tenant_Name__c: "Quarter-close Tenant",
        Address__c: "Frozen Address",
        Deal_Type__c: "New",
        Lease__r: {
          ascendix__Tenant__r: { Name: "Current Tenant" },
          Deal_Type__c: "Changed",
        },
      }),
    ]);
    expect(mapped.leasing[0]).toMatchObject({
      tenant: "Quarter-close Tenant",
      address: "Frozen Address",
      leaseType: "New",
    });
  });
});
