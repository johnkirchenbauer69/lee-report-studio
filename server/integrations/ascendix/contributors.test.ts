import { describe, expect, it } from "vitest";
import {
  contributorSection,
  mapHistoricalContributors,
  rankContributors,
  resolveDisplayParty,
  saleRankBasisMismatch,
  scopeHistoricalContributors,
  selectDisplayLease,
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
  it("retains the governed unavailable state when the linked property has no primary image", async () => {
    const mapped = await mapHistoricalContributors([
      row({
        Id: "q3-no-image",
        Contributor_Category__c: "Largest Under Construction",
        Under_Construction_SF__c: 190_000,
        Address__c: "840 25th Ave, Bellwood, IL 60104",
        Property__r: { ascendix__PrimaryImage__c: "" },
      }),
    ]);
    expect(mapped.construction[0]).toMatchObject({
      address: "840 25th Ave, Bellwood, IL 60104",
      image: "",
    });
    expect(mapped.imageWarnings).toEqual([]);
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
  it("maps deterministic positive and negative absorption contributors", async () => {
    const mapped = await mapHistoricalContributors([
      row({
        Id: "positive",
        Contributor_Category__c: "Largest Positive Net Absorption",
        Metric_Value__c: 650_000,
        Source_Record_Name__c: "Positive Distribution Center",
        Address__c: "100 Growth Way",
      }),
      row({
        Id: "negative",
        Contributor_Category__c: "Largest Negative Net Absorption",
        Metric_Value__c: 225_000,
        Source_Record_Name__c: "Vacated Warehouse",
        Address__c: "200 Loss Lane",
      }),
    ]);
    expect(mapped.absorptionContributors).toEqual([
      expect.objectContaining({
        propertyName: "Positive Distribution Center",
        contributionSf: 650_000,
        direction: "positive",
        deterministicallyIdentified: true,
      }),
      expect.objectContaining({
        propertyName: "Vacated Warehouse",
        contributionSf: -225_000,
        direction: "negative",
        deterministicallyIdentified: true,
      }),
    ]);
    expect(mapped.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldPath: "absorptionContributors.0",
          authority: expect.stringContaining("absorption ranking"),
        }),
      ]),
    );
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
          Is_Deal_Confidential__c: false,
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

  it("uses the Sale object's Sale_Type__c and cannot leak Included as Sale Type", async () => {
    const mapped = await mapHistoricalContributors([
      row({
        Id: "sale-contract",
        Contributor_Category__c: "Sale",
        Sale_Price__c: 2_000_000,
        Buyer_Name__c: "001al00000dS4qYAAS",
        Address__c: "100 Main St",
        Sale_Type__c: "Included",
        Deal_Type__c: "Included",
        Source_Status__c: "Included",
        Sale__r: {
          Sale_Type__c: "Owner/User",
          ascendix__Buyer__r: { Normalized_Name__c: "Acme Holdings" },
        },
      }),
    ]);
    expect(mapped.sales[0]).toEqual({
      buyer: "Acme Holdings",
      isLeeDeal: null,
      price: 2_000_000,
      address: "100 Main St",
      saleType: "Owner/User",
      sizeSf: undefined,
      pricePerSf: null,
    });
    expect(JSON.stringify(mapped.sales)).not.toContain("Included");
    expect(JSON.stringify(mapped.sales)).not.toContain("001al00000dS4qYAAS");
  });

  it.each([
    {
      label: "confidential linked tenant",
      confidential: true,
      nativeTenant: "Quarter-close Tenant",
      linkedTenant: "Secret Tenant",
      expected: "(Confidential)",
    },
    {
      label: "non-confidential linked tenant",
      confidential: false,
      nativeTenant: "Published Tenant",
      linkedTenant: "Current Tenant",
      expected: "Published Tenant",
    },
    {
      label: "missing tenant",
      confidential: false,
      nativeTenant: "",
      linkedTenant: "",
      expected: "Tenant not published",
    },
  ])("applies Lease.Is_Deal_Confidential__c for $label", async (fixture) => {
    const mapped = await mapHistoricalContributors([
      row({
        Id: `lease-${fixture.label}`,
        Contributor_Category__c: "Lease",
        Lease_SF__c: 125_000,
        Address__c: "200 Main St",
        Tenant_Name__c: fixture.nativeTenant,
        Deal_Type__c: "New",
        Lease__r: {
          Is_Deal_Confidential__c: fixture.confidential,
          ascendix__Tenant__r: { Name: fixture.linkedTenant },
        },
      }),
    ]);
    expect(mapped.leasing[0]).toMatchObject({
      tenant: fixture.expected,
      tenantDisplayName: fixture.expected,
      isDealConfidential: fixture.confidential,
      sizeSf: 125_000,
      address: "200 Main St",
      leaseType: "New",
    });
    if (fixture.confidential)
      expect(JSON.stringify(mapped.leasing[0])).not.toContain("Secret Tenant");
  });

  it("fails closed when Lease confidentiality is unavailable", async () => {
    const mapped = await mapHistoricalContributors([
      row({
        Id: "lease-unverified",
        Contributor_Category__c: "Lease",
        Lease_SF__c: 125_000,
        Address__c: "200 Main St",
        Tenant_Name__c: "Native Tenant That Must Never Leak",
        Deal_Type__c: "New",
      }),
    ]);

    expect(mapped.leasing[0]).toMatchObject({
      tenant: "(Confidential)",
      tenantDisplayName: "(Confidential)",
      isDealConfidential: null,
    });
    expect(JSON.stringify(mapped)).not.toContain(
      "Native Tenant That Must Never Leak",
    );
  });

  it("uses only verified linked Lease and Sale booleans for Lee Deal status", async () => {
    const mapped = await mapHistoricalContributors([
      row({
        Id: "lease-lee",
        Contributor_Category__c: "Lease",
        Is_Lee_Deal__c: false,
        Lease_SF__c: 125_000,
        Address__c: "200 Main St",
        Tenant_Name__c: "Secret Tenant That Must Not Leak",
        Lease__c: "linked-lease",
        Deal_Type__c: "New",
        Lease__r: {
          Is_Deal_Confidential__c: true,
          Lee_Deal__c: true,
        },
      }),
      row({
        Id: "sale-lee",
        Contributor_Category__c: "Sale",
        Is_Lee_Deal__c: false,
        Sale_Price__c: 2_000_000,
        Address__c: "100 Main St",
        Buyer_Name__c: "Acme Holdings",
        Sale__c: "linked-sale",
        Sale__r: { Lee_Deal__c: true, Sale_Type__c: "Investment" },
      }),
    ]);

    expect(mapped.leasing[0]?.isLeeDeal).toBe(true);
    expect(mapped.leasing[0]?.tenantDisplayName).toBe("(Confidential)");
    expect(JSON.stringify(mapped.leasing[0])).not.toContain(
      "Secret Tenant That Must Not Leak",
    );
    expect(mapped.sales[0]?.isLeeDeal).toBe(true);
    expect(mapped.provenance[0]?.selectedValue).toMatchObject({
      isLeeDeal: true,
    });
    expect(mapped.provenance[1]?.selectedValue).toMatchObject({
      isLeeDeal: true,
    });
    expect(mapped.provenance[0]?.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reference: "ascendix__Lease__c.Lee_Deal__c",
          value: true,
        }),
      ]),
    );
    expect(mapped.provenance[1]?.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reference: "ascendix__Sale__c.Lee_Deal__c",
          value: true,
        }),
      ]),
    );
  });

  it("keeps Lee Deal status unknown when linked enrichment is unavailable", async () => {
    const mapped = await mapHistoricalContributors([
      row({
        Id: "sale-unverified",
        Contributor_Category__c: "Sale",
        Is_Lee_Deal__c: true,
        Sale_Price__c: 2_000_000,
        Address__c: "100 Main St",
        Buyer_Name__c: "Acme Holdings",
      }),
    ]);

    expect(mapped.sales[0]?.isLeeDeal).toBeNull();
  });

  describe("Top Sales size and Price/SF", () => {
    it("prefers the canonical enriched Sale relation for Sold SF and the verified Price/SF", async () => {
      const mapped = await mapHistoricalContributors([
        row({
          Id: "sale-full",
          Contributor_Category__c: "Sale",
          Sale_Price__c: 9_600_000,
          Buyer_Name__c: "Acme Holdings",
          Address__c: "100 Main St",
          Sale_Type__c: "Investment",
          Sale__r: {
            Building_SF__c: 80_000,
            ascendix__SalePricePerUOM__c: 120,
          },
        }),
      ]);
      expect(mapped.sales[0]).toMatchObject({ sizeSf: 80_000, pricePerSf: 120 });
    });

    it("falls back to the contributor row's own denormalized Building_SF__c (the canonical Sold SF field reused across sections) when enrichment is unavailable", async () => {
      const mapped = await mapHistoricalContributors([
        row({
          Id: "sale-fallback-sf",
          Contributor_Category__c: "Sale",
          Sale_Price__c: 1_000_000,
          Buyer_Name__c: "Acme Holdings",
          Address__c: "100 Main St",
          Sale_Type__c: "Investment",
          Building_SF__c: 50_000,
        }),
      ]);
      // No verified Price/SF source and no size -> derived in the data layer
      // from price / sizeSf, never in the presentation layer.
      expect(mapped.sales[0]).toMatchObject({
        sizeSf: 50_000,
        pricePerSf: 20,
      });
    });

    it("reports size only when Price/SF cannot be resolved or derived", async () => {
      const mapped = await mapHistoricalContributors([
        row({
          Id: "sale-size-only",
          Contributor_Category__c: "Sale",
          Buyer_Name__c: "Acme Holdings",
          Address__c: "100 Main St",
          Sale_Type__c: "Investment",
          Sale__r: { Building_SF__c: 40_000 },
        }),
      ]);
      expect(mapped.sales[0]).toMatchObject({
        sizeSf: 40_000,
        pricePerSf: null,
      });
    });

    it("reports the verified Price/SF only when Sold SF is unavailable", async () => {
      const mapped = await mapHistoricalContributors([
        row({
          Id: "sale-price-per-sf-only",
          Contributor_Category__c: "Sale",
          Sale_Price__c: 1_000_000,
          Buyer_Name__c: "Acme Holdings",
          Address__c: "100 Main St",
          Sale_Type__c: "Investment",
          Sale__r: { ascendix__SalePricePerUOM__c: 95 },
        }),
      ]);
      expect(mapped.sales[0]).toMatchObject({
        sizeSf: undefined,
        pricePerSf: 95,
      });
    });

    it("reports neither field when nothing is available", async () => {
      const mapped = await mapHistoricalContributors([
        row({
          Id: "sale-neither",
          Contributor_Category__c: "Sale",
          Sale_Price__c: 1_000_000,
          Buyer_Name__c: "Acme Holdings",
          Address__c: "100 Main St",
          Sale_Type__c: "Investment",
        }),
      ]);
      expect(mapped.sales[0]).toMatchObject({
        sizeSf: undefined,
        pricePerSf: null,
      });
    });
  });

  describe("resolveDisplayParty", () => {
    it("leads with the tenant for Built-to-Suit", () => {
      expect(
        resolveDisplayParty({
          developmentTypeRaw: "Built-to-Suit",
          tenantName: "CJ Logistics",
          ownerName: "Owner Co",
          developerName: "Developer Co",
        }),
      ).toEqual({ displayParty: "CJ Logistics", displayPartySource: "tenant" });
    });

    it("falls back to owner when a Built-to-Suit tenant is unavailable", () => {
      expect(
        resolveDisplayParty({
          developmentTypeRaw: "Built-to-Suit",
          ownerName: "Owner Co",
          developerName: "Developer Co",
        }),
      ).toEqual({ displayParty: "Owner Co", displayPartySource: "owner" });
    });

    it("falls back to developer when a Built-to-Suit tenant and owner are both unavailable", () => {
      expect(
        resolveDisplayParty({
          developmentTypeRaw: "Built-to-Suit",
          developerName: "Developer Co",
        }),
      ).toEqual({
        displayParty: "Developer Co",
        displayPartySource: "developer",
      });
    });

    it("leads with the tenant for Expansion", () => {
      expect(
        resolveDisplayParty({
          developmentTypeRaw: "Expansion",
          tenantName: "Widget Co",
        }),
      ).toEqual({ displayParty: "Widget Co", displayPartySource: "tenant" });
    });

    it("keeps developer-first attribution for Speculative and other development types", () => {
      expect(
        resolveDisplayParty({
          developmentTypeRaw: "Speculative",
          tenantName: "Should Not Be Used",
          ownerName: "Owner Co",
          developerName: "Developer Co",
        }),
      ).toEqual({
        displayParty: "Developer Co",
        displayPartySource: "developer",
      });
      expect(
        resolveDisplayParty({
          developmentTypeRaw: "Speculative",
          ownerName: "Owner Co",
        }),
      ).toEqual({ displayParty: "Owner Co", displayPartySource: "owner" });
    });

    it("returns a safe null fallback rather than an arbitrary party when nothing resolves", () => {
      expect(resolveDisplayParty({ developmentTypeRaw: "Built-to-Suit" })).toEqual({
        displayParty: null,
        displayPartySource: null,
      });
      expect(resolveDisplayParty({ developmentTypeRaw: "Speculative" })).toEqual({
        displayParty: null,
        displayPartySource: null,
      });
    });
  });

  describe("selectDisplayLease", () => {
    it("returns undefined for no candidates", () => {
      expect(selectDisplayLease([])).toBeUndefined();
    });

    it("prefers a new/direct transaction over a renewal", () => {
      const renewal = { Id: "l1", Deal_Type__c: "Renewal", ascendix__Size__c: 500_000 };
      const direct = { Id: "l2", Deal_Type__c: "New", ascendix__Size__c: 10_000 };
      expect(selectDisplayLease([renewal, direct])?.Id).toBe("l2");
    });

    it("prefers the most recent lease when transaction type ties", () => {
      const older = {
        Id: "l1",
        Deal_Type__c: "New",
        Off_Market_Date__c: "2025-01-01",
      };
      const newer = {
        Id: "l2",
        Deal_Type__c: "New",
        Off_Market_Date__c: "2026-06-01",
      };
      expect(selectDisplayLease([older, newer])?.Id).toBe("l2");
    });

    it("prefers the larger lease when type and recency tie", () => {
      const smaller = {
        Id: "l1",
        Deal_Type__c: "New",
        Off_Market_Date__c: "2026-01-01",
        ascendix__Size__c: 50_000,
      };
      const larger = {
        Id: "l2",
        Deal_Type__c: "New",
        Off_Market_Date__c: "2026-01-01",
        ascendix__Size__c: 200_000,
      };
      expect(selectDisplayLease([smaller, larger])?.Id).toBe("l2");
    });

    it("falls back to a deterministic Id order rather than an arbitrary first result when every signal ties", () => {
      const a = { Id: "b-lease", Deal_Type__c: "New", ascendix__Size__c: 10_000 };
      const b = { Id: "a-lease", Deal_Type__c: "New", ascendix__Size__c: 10_000 };
      expect(selectDisplayLease([a, b])?.Id).toBe("a-lease");
      expect(selectDisplayLease([b, a])?.Id).toBe("a-lease");
    });
  });

  describe("Delivered/Under Construction display-party integration", () => {
    const btsCommon = {
      Rank__c: 1,
      Sort_Value__c: 100,
      Property__r: {
        ascendix__ExpansionType__c: "Built-to-Suit",
        ascendix__Developer__r: { Name: "Developer Co" },
        ascendix__OwnerLandlord__r: { Name: "Owner Co" },
      },
    };
    it("shows the tenant on a Built-to-Suit delivery when a lease was matched", async () => {
      const mapped = await mapHistoricalContributors([
        row({
          ...btsCommon,
          Id: "delivery-bts-tenant",
          Contributor_Category__c: "Delivery",
          Delivered_SF__c: 100_000,
          Address__c: "1 Main St",
          Display_Lease__r: {
            Id: "lease-1",
            Is_Deal_Confidential__c: false,
            ascendix__Tenant__r: { Name: "CJ Logistics" },
          },
        }),
      ]);
      expect(mapped.deliveries[0]).toMatchObject({
        displayParty: "CJ Logistics",
        displayPartySource: "tenant",
        relatedLeaseId: "lease-1",
        displayPartyMatchMethod: "property-lookup",
      });
    });

    it("falls back to owner on a Built-to-Suit construction card when no lease was matched", async () => {
      const mapped = await mapHistoricalContributors([
        row({
          ...btsCommon,
          Id: "construction-bts-owner",
          Contributor_Category__c: "Under Construction",
          Under_Construction_SF__c: 100_000,
          Address__c: "1 Main St",
        }),
      ]);
      expect(mapped.construction[0]).toMatchObject({
        displayParty: "Owner Co",
        displayPartySource: "owner",
        displayPartyMatchMethod: "none",
      });
    });

    it("falls back to developer when neither tenant nor owner is available", async () => {
      const mapped = await mapHistoricalContributors([
        row({
          Id: "delivery-bts-developer",
          Contributor_Category__c: "Delivery",
          Delivered_SF__c: 100_000,
          Address__c: "1 Main St",
          Property__r: {
            ascendix__ExpansionType__c: "Built-to-Suit",
            ascendix__Developer__r: { Name: "Developer Co" },
          },
        }),
      ]);
      expect(mapped.deliveries[0]).toMatchObject({
        displayParty: "Developer Co",
        displayPartySource: "developer",
      });
    });

    it("shows the tenant on an Expansion delivery", async () => {
      const mapped = await mapHistoricalContributors([
        row({
          Id: "delivery-expansion-tenant",
          Contributor_Category__c: "Delivery",
          Delivered_SF__c: 100_000,
          Address__c: "1 Main St",
          Property__r: { ascendix__ExpansionType__c: "Expansion" },
          Display_Lease__r: {
            Id: "lease-2",
            Is_Deal_Confidential__c: false,
            ascendix__Tenant__r: { Name: "Widget Co" },
          },
        }),
      ]);
      expect(mapped.deliveries[0]).toMatchObject({
        displayParty: "Widget Co",
        displayPartySource: "tenant",
      });
    });

    it("keeps the existing developer/owner attribution for a Speculative project", async () => {
      const mapped = await mapHistoricalContributors([
        row({
          Id: "delivery-spec",
          Contributor_Category__c: "Delivery",
          Delivered_SF__c: 100_000,
          Address__c: "1 Main St",
          Property__r: {
            ascendix__ExpansionType__c: "Speculative",
            ascendix__Developer__r: { Name: "Developer Co" },
            ascendix__OwnerLandlord__r: { Name: "Owner Co" },
          },
          // A Speculative project should never surface a tenant even if one
          // happened to be attached (deterministic lookup is BTS/Expansion-only).
          Display_Lease__r: {
            Id: "lease-3",
            Is_Deal_Confidential__c: false,
            ascendix__Tenant__r: { Name: "Should Not Appear" },
          },
        }),
      ]);
      expect(mapped.deliveries[0]).toMatchObject({
        displayParty: "Developer Co",
        displayPartySource: "developer",
      });
    });

    it("never surfaces a confidential tenant, falling back to owner instead", async () => {
      const mapped = await mapHistoricalContributors([
        row({
          ...btsCommon,
          Id: "delivery-bts-confidential",
          Contributor_Category__c: "Delivery",
          Delivered_SF__c: 100_000,
          Address__c: "1 Main St",
          Display_Lease__r: {
            Id: "lease-4",
            Is_Deal_Confidential__c: true,
            ascendix__Tenant__r: { Name: "Secret Tenant" },
          },
        }),
      ]);
      expect(mapped.deliveries[0]?.displayParty).toBe("Owner Co");
      expect(JSON.stringify(mapped.deliveries[0])).not.toContain(
        "Secret Tenant",
      );
    });
  });
});


describe("generic Top Lease selection", () => {
  const generic = (overrides: Record<string, unknown> = {}) => row({
    Id: "generic", Contributor_Category__c: "Largest Lease", Lease__c: "L1",
    Narrative_Eligible__c: true, Is_Deal_Confidential__c: false,
    Calculation_Version__c: "mde-lease-reporting-v1", Sort_Value__c: 200,
    Submarket__c: "I-57 Corridor", Quarter_Label__c: "2026 Q3", Run_ID__c: "run",
    ...overrides,
  });
  it("uses generic rows without duplicating analytical New/Renewal views", () => {
    const rows = [generic(), generic({ Id: "new", Contributor_Category__c: "Largest New Lease", Sort_Value__c: 999 }),
      generic({ Id: "expansion", Contributor_Category__c: "Largest Expansion", Sort_Value__c: 999 })];
    expect(rankContributors(rows, "leasing").map(r => r.Id)).toEqual(["generic"]);
  });
  it("does not fall back when a versioned run has no publishable generic row", () => {
    expect(rankContributors([generic({ Contributor_Category__c: "Largest New Lease" })], "leasing")).toEqual([]);
    expect(rankContributors([generic({ Narrative_Eligible__c: false })], "leasing")).toEqual([]);
    expect(rankContributors([generic({ Is_Deal_Confidential__c: true })], "leasing")).toEqual([]);
  });
  it("retains legacy fallback separately for older submarket populations", () => {
    const legacy = row({ Id: "old", Contributor_Category__c: "Largest Renewal Lease", Submarket__c: "Other", Sort_Value__c: 100 });
    expect(rankContributors([generic(), legacy], "leasing").map(r => r.Id)).toEqual(["generic", "old"]);
  });
  it("deduplicates lease source identity and deterministically resolves equal sizes", () => {
    const rows = [generic({ Id: "b", Lease__c: "L2" }), generic({ Id: "a", Lease__c: "L1" }),
      generic({ Id: "c", Lease__c: "L1" })];
    expect(rankContributors(rows, "leasing").map(r => r.Id)).toEqual(["a", "b"]);
  });
  it.each(["Sublet", "Assignment"])("renders %s with blank subtype without internal status text", async (channel) => {
    const mapped = await mapHistoricalContributors([generic({
      Deal_Type__c: channel, Deal_Sub_Type__c: "", Source_Status__c: "Confidentiality: False | Deal_Sub_Type: Not Applicable",
      Lease__r: { Deal_Sub_Type__c: "New", Is_Deal_Confidential__c: false },
    })]);
    expect(mapped.leasing[0].leaseType).toBe(channel);
  });
  it.each(["New", "Renewal", "Expansion", "Renewal / Expansion"])("preserves Direct / %s display", async (event) => {
    const mapped = await mapHistoricalContributors([generic({ Deal_Type__c: "Direct", Deal_Sub_Type__c: event })]);
    expect(mapped.leasing[0].leaseType).toBe(`Direct / ${event}`);
  });
});

describe("Top Sales: selected by Sold / Building SF", () => {
  const sale = (
    id: string,
    soldSf: number | null,
    price: number,
    extra: Record<string, unknown> = {},
  ) =>
    row({
      Id: `contributor-${id}`,
      Contributor_Category__c: "Largest Sale",
      Sale__c: id,
      Sale_Price__c: price,
      Metric_Value__c: price,
      Sort_Value__c: price,
      Building_SF__c: null,
      Sale__r: soldSf === null ? undefined : { Building_SF__c: soldSf },
      Submarket__c: "Fox Valley",
      ...extra,
    }) as ReturnType<typeof row> & Record<string, unknown>;

  it("orders the Q3 Fox Valley rows 258,720 / 250,100 / 58,968 SF (not by price)", async () => {
    const rows = [
      sale("a0OVy00000AgfsDMAR", 250_100, 30_700_000, { Rank__c: 1 }),
      sale("a0OVy00000AfBzRMAV", 258_720, 29_100_000, { Rank__c: 2 }),
      sale("a0OVy00000AgUYcMAN", 58_968, 17_250_000, { Rank__c: 3 }),
    ];
    const mapped = await mapHistoricalContributors(rows);
    expect(mapped.sales.map((item) => item.sizeSf)).toEqual([
      258_720, 250_100, 58_968,
    ]);
    // $/SF is unchanged: it still comes from the sale's own price / size.
    expect(mapped.sales[0]!.pricePerSf).toBeCloseTo(29_100_000 / 258_720, 6);
  });

  it("SELECTS the three largest by size from the population, never a price-top-three re-sorted", () => {
    // Price ranking would choose p1, p2, p3. A large, cheap sale (big) must
    // displace the smallest of them, and a merely re-sorted price set would
    // never contain it.
    const rows = [
      sale("p1", 240_000, 13_211_579),
      sale("p2", 37_000, 11_750_000),
      sale("p3", 152_679, 8_325_000),
      sale("big", 185_672, 3_450_000),
      sale("small", 20_396, 1_400_000),
    ];
    const byPrice = [...rows]
      .sort((a, b) => Number(b.Sale_Price__c) - Number(a.Sale_Price__c))
      .slice(0, 3)
      .map((item) => item.Sale__c);
    const selected = rankContributors(rows, "sales").map((item) => item.Sale__c);
    expect(byPrice).toEqual(["p1", "p2", "p3"]);
    expect(selected).toEqual(["p1", "big", "p3"]);
    expect(selected).not.toContain("p2");
    const sizes = rows
      .map((item) => (item.Sale__r as { Building_SF__c: number }).Building_SF__c)
      .sort((a, b) => b - a)
      .slice(0, 3);
    expect(
      rankContributors(rows, "sales").map(
        (item) => (item.Sale__r as { Building_SF__c: number }).Building_SF__c,
      ),
    ).toEqual(sizes);
  });

  it("selects the Overall Market top three by size across every submarket's rows", async () => {
    const rows = [
      sale("i80", 1_200_000, 133_308_100, { Submarket__c: "I-80 Corridor/Joliet" }),
      sale("sew", 736_205, 87_000_000, { Submarket__c: "Southeast Wisconsin" }),
      sale("i55", 767_161, 86_500_000, { Submarket__c: "I-55 Corridor" }),
      sale("nk", 385_372, 38_325_000, { Submarket__c: "North Kane" }),
      sale("fv", 258_720, 29_100_000, { Submarket__c: "Fox Valley" }),
    ];
    const mapped = await mapHistoricalContributors(rows);
    expect(mapped.sales.map((item) => item.sizeSf)).toEqual([
      1_200_000, 767_161, 736_205,
    ]);
  });

  it("breaks size ties by Sale Price descending, then by stable Salesforce Sale identity", () => {
    const rows = [
      sale("b-id", 100_000, 5_000_000),
      sale("a-id", 100_000, 5_000_000),
      sale("cheap", 100_000, 4_000_000),
      sale("rich", 100_000, 9_000_000),
    ];
    expect(rankContributors(rows, "sales", 4).map((item) => item.Sale__c)).toEqual(
      ["rich", "a-id", "b-id", "cheap"],
    );
    expect(
      rankContributors([...rows].reverse(), "sales", 4).map((item) => item.Sale__c),
    ).toEqual(["rich", "a-id", "b-id", "cheap"]);
  });

  it("falls back to the contributor Building_SF__c, ranks unknown sizes last, and de-duplicates a sale", () => {
    const rows = [
      sale("unknown", null, 99_000_000),
      sale("denormalized", null, 1_000_000, { Building_SF__c: 300_000 }),
      sale("enriched", 200_000, 2_000_000),
      sale("enriched", 200_000, 2_000_000, { Id: "duplicate-row" }),
    ];
    expect(rankContributors(rows, "sales").map((item) => item.Sale__c)).toEqual([
      "denormalized",
      "enriched",
      "unknown",
    ]);
  });

  it("reports the upstream rank-basis mismatch for price-ranked Largest Sale rows", () => {
    const priceRanked = [
      sale("x", 1, 1, {
        Rank_Basis__c: "Sale price descending, then sold SF descending",
      }),
    ];
    expect(saleRankBasisMismatch(priceRanked)).toMatch(
      /Top Sales upstream contract mismatch.*Sale price descending/,
    );
    const sizeRanked = [
      sale("y", 1, 1, { Rank_Basis__c: "Sold SF descending, then sale price descending" }),
    ];
    expect(saleRankBasisMismatch(sizeRanked)).toBeUndefined();
    expect(saleRankBasisMismatch([])).toBeUndefined();
  });
});
