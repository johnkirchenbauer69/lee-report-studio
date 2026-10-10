import { describe, expect, it } from "vitest";
import { q2SampleReport } from "../../data-providers/sample/q2SampleReport";
import { buildPresentationModel } from "./presentationModel";
import { containsSalesforceIdToken } from "../../shared/salesforceIds";

describe("buildPresentationModel", () => {
  it("uses approved presentation overrides without mutating normalized calculations", () => {
    const model = buildPresentationModel(q2SampleReport);
    const totalRow = model.submarketTableRows.find(
      (row) => row.kind === "total",
    );

    expect(totalRow?.speculative).toBe("34%");
    expect(model.overallMarket.speculativeShare).not.toBe(0.3381477655);
  });

  it("binds the table and narrative to quarterly absorption and indicators to T12", () => {
    const model = buildPresentationModel(q2SampleReport);
    const totalRow = model.submarketTableRows.find(
      (row) => row.kind === "total",
    );
    const absorptionIndicator = model.indicatorRows.find((row) =>
      row.metric.includes("12 Month Net Absorption"),
    );

    expect(totalRow?.absorption).toBe("5,206,811");
    expect(model.overallMarket.quarterlyNetAbsorptionSf).toBe(5_206_811);
    expect(model.overallMarket.narrative).toContain(
      "Quarterly net absorption totaled 5.21 million square feet",
    );
    expect(absorptionIndicator?.q2).toBe("17,654,829");
  });

  it.each([0, 1, 2, 3, 4])(
    "keeps exactly three Top Lease and Top Sale rows for %i source records",
    (count) => {
      const report = structuredClone(q2SampleReport);
      report.leasing = report.leasing.slice(0, count);
      report.sales = report.sales.slice(0, count);
      const model = buildPresentationModel(report);
      expect(model.topLeaseRows).toHaveLength(3);
      expect(model.topSaleRows).toHaveLength(3);
      const expectedPlaceholders = Math.max(0, 3 - count);
      expect(
        model.topLeaseRows.filter((row) =>
          [row.party, row.amount, row.address, row.type].every(
            (value) => value === "-",
          ),
        ),
      ).toHaveLength(expectedPlaceholders);
      expect(
        model.topSaleRows.filter((row) =>
          [row.party, row.amount, row.address, row.type].every(
            (value) => value === "-",
          ),
        ),
      ).toHaveLength(expectedPlaceholders);
    },
  );

  it("keeps three highlight slots and distinguishes no record from missing image", () => {
    const report = structuredClone(q2SampleReport);
    report.availabilities = [
      { ...report.availabilities[0]!, image: "" },
      report.availabilities[1]!,
    ];
    report.deliveries = [];
    report.construction = report.construction.slice(0, 1);
    const model = buildPresentationModel(report);
    expect(model.topAvailabilities.map((item) => item.state)).toEqual([
      "image-unavailable",
      "record",
      "none",
    ]);
    expect(model.topDeliveries.map((item) => item.state)).toEqual([
      "none",
      "none",
      "none",
    ]);
    expect(model.topConstruction).toHaveLength(3);
    expect(model.topConstruction[1]).toMatchObject({
      state: "none",
      address: "",
      detail: "",
    });
  });

  it("suppresses Included from client-facing Sale Type cells", () => {
    const report = structuredClone(q2SampleReport);
    report.sales[0]!.saleType = "Included";
    const model = buildPresentationModel(report);
    expect(model.topSaleRows[0]!.type).toBe("Sale type not published");
    expect(JSON.stringify(model.topSaleRows)).not.toContain("Included");
  });

  describe("Top Sales SIZE (SF) / PRICE ($/SF)", () => {
    it("combines both values when the report already carries the canonical size and Price/SF", () => {
      const report = structuredClone(q2SampleReport);
      report.sales[0]!.sizeSf = 80_000;
      report.sales[0]!.pricePerSf = 120;
      const model = buildPresentationModel(report);
      expect(model.topSaleRows[0]!.sizePricePerSf).toBe("80,000 SF / $120/SF");
    });

    it("shows size only when Price/SF is unavailable", () => {
      const report = structuredClone(q2SampleReport);
      report.sales[0]!.sizeSf = 80_000;
      report.sales[0]!.pricePerSf = null;
      const model = buildPresentationModel(report);
      expect(model.topSaleRows[0]!.sizePricePerSf).toBe("80,000 SF");
    });

    it("shows Price/SF only when size is unavailable", () => {
      const report = structuredClone(q2SampleReport);
      delete report.sales[0]!.sizeSf;
      report.sales[0]!.pricePerSf = 120;
      const model = buildPresentationModel(report);
      expect(model.topSaleRows[0]!.sizePricePerSf).toBe("$120/SF");
    });

    it("falls back to the existing missing/not-published convention when neither is available", () => {
      const report = structuredClone(q2SampleReport);
      delete report.sales[0]!.sizeSf;
      report.sales[0]!.pricePerSf = null;
      const model = buildPresentationModel(report);
      expect(model.topSaleRows[0]!.sizePricePerSf).toBe("-");
    });

    it("never recalculates Price/SF in the presentation layer -- it only formats whatever the payload already has", () => {
      const report = structuredClone(q2SampleReport);
      // Deliberately inconsistent with price/size so a passing test proves
      // the presentation layer trusts the payload rather than deriving its
      // own value from price and size.
      report.sales[0]!.price = 999_999_999;
      report.sales[0]!.sizeSf = 80_000;
      report.sales[0]!.pricePerSf = 120;
      const model = buildPresentationModel(report);
      expect(model.topSaleRows[0]!.sizePricePerSf).toBe("80,000 SF / $120/SF");
    });
  });

  describe("Top Leases/Top Sales address formatting", () => {
    it("drops the trailing ZIP code from Top Sales addresses while keeping city and state", () => {
      const report = structuredClone(q2SampleReport);
      report.sales[0]!.address = "23301 S Central Ave, University Park, IL 60484";
      const model = buildPresentationModel(report);
      expect(model.topSaleRows[0]!.address).toBe(
        "23301 S Central Ave, University Park, IL",
      );
    });

    it("drops the trailing ZIP+4 code from Top Sales addresses", () => {
      const report = structuredClone(q2SampleReport);
      report.sales[0]!.address = "23301 S Central Ave, University Park, IL 60484-1234";
      const model = buildPresentationModel(report);
      expect(model.topSaleRows[0]!.address).toBe(
        "23301 S Central Ave, University Park, IL",
      );
    });

    it("drops the trailing ZIP code from Top Leases addresses while keeping city and state", () => {
      const report = structuredClone(q2SampleReport);
      report.leasing[0]!.address = "3835 Youngs Rd, Channahon, IL 60410";
      const model = buildPresentationModel(report);
      expect(model.topLeaseRows[0]!.address).toBe(
        "3835 Youngs Rd, Channahon, IL",
      );
    });

    it("leaves an address unchanged when it has no trailing ZIP to remove", () => {
      const report = structuredClone(q2SampleReport);
      report.sales[0]!.address = "Address not published";
      const model = buildPresentationModel(report);
      expect(model.topSaleRows[0]!.address).toBe("Address not published");
    });

    it("does not affect the canonical address elsewhere in the report", () => {
      const report = structuredClone(q2SampleReport);
      report.sales[0]!.address = "23301 S Central Ave, University Park, IL 60484";
      const model = buildPresentationModel(report);
      // The raw dataSnapshot-level field (not the Top Sales table row) is untouched.
      expect(report.sales[0]!.address).toBe(
        "23301 S Central Ave, University Park, IL 60484",
      );
    });
  });

  it("normalizes verified Lee Deal booleans and never marks placeholder rows", () => {
    const report = structuredClone(q2SampleReport);
    report.leasing = [
      { ...report.leasing[0]!, isLeeDeal: true },
      { ...report.leasing[1]!, isLeeDeal: false },
    ];
    report.sales = [{ ...report.sales[0]!, isLeeDeal: null }];
    const model = buildPresentationModel(report);

    expect(model.topLeaseRows.map((row) => row.isLeeDeal)).toEqual([
      true,
      false,
      false,
    ]);
    expect(model.topSaleRows.map((row) => row.isLeeDeal)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("recursively removes Salesforce IDs from the complete client presentation", () => {
    const report = structuredClone(q2SampleReport);
    report.provenance.push({
      fieldPath: "reconciliation.submarkets.O'Hare.inventorySf",
      selectedValue: 1,
      sources: [
        {
          sourceId: "a0B5f000001AbCdEAK",
          sourceType: "salesforce",
          value: "Diagnostic 001al00000dS4qYAAS record",
        },
      ],
      authority: "Market_Data__c",
      status: "reconciled",
      reconciliation: {
        classification: "warning",
        authoritativeValue: 1,
        comparisonValue: 2,
        varianceAbsolute: 1,
        variancePercentage: 1,
        reason: "Review 001al00000dS4qYAAS",
        details: {
          determination: "candidate-match",
          explanation: "Candidate",
          sourceCriteria: ["Id = a0B5f000001AbCdEAK"],
          includedRecordCount: 1,
          candidateTotalSf: 1,
          diagnosticOnly: true,
          records: [
            {
              propertyDataId: "a0B5f000001AbCdEAK",
              propertyId: "001al00000dS4qYAAS",
              property: "100 Main Street",
              address: "100 Main Street",
              buildingSf: 1,
              canonicalSubmarket: "O'Hare",
              includedInPropertyDataAggregation: true,
              expectedOfficialScope: null,
              classification: "candidate",
              reason: "Candidate",
            },
          ],
        },
      },
    });
    const model = buildPresentationModel(report);
    const strings: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object")
        Object.values(value).forEach(collect);
    };
    collect(model);
    expect(strings.some(containsSalesforceIdToken)).toBe(false);
    expect(JSON.stringify(model)).toContain("100 Main Street");
  });
});
