import { describe, expect, it } from "vitest";
import { buildInventoryReconciliationDetails } from "./inventoryReconciliationDetails";

describe("inventory reconciliation drill-down", () => {
  it("returns a transparent single-record Chicago South candidate without guessing official scope", () => {
    const result = buildInventoryReconciliationDetails({
      rows: [
        {
          Id: "a01-property-data",
          Name: "Snapshot row",
          Property__c: "a02-property",
          Submarket__c: "Chicago South",
          Inventory_SF__c: 65_200,
          Property__r: {
            Name: "123 Industrial Drive",
            ascendix__Street__c: "123 Industrial Drive",
            ascendix__City__c: "Chicago",
            State__c: "IL",
          },
        },
        {
          Id: "a01-context",
          Submarket__c: "Chicago South",
          Inventory_SF__c: 900_000,
        },
      ],
      submarket: "Chicago South",
      varianceAbsolute: 65_200,
      period: "2026 Q2",
      scope: "Eligible 20K+ Market Universe",
    });
    expect(result).toMatchObject({
      determination: "candidate-match",
      includedRecordCount: 2,
      candidateTotalSf: 65_200,
      diagnosticOnly: true,
      records: [
        {
          property: "123 Industrial Drive",
          propertyId: "a02-property",
          buildingSf: 65_200,
          expectedOfficialScope: null,
          classification: "candidate",
        },
      ],
    });
    expect(result.explanation).toContain("not a proven exclusion");
    expect(result.sourceCriteria).toContain(
      "Operation = read-only Salesforce query; no writeback",
    );
  });

  it("keeps West Cook known-difference diagnostics visible", () => {
    const result = buildInventoryReconciliationDetails({
      rows: [
        {
          Id: "west-cook-row",
          Submarket__c: "West Cook",
          Inventory_SF__c: 82_000,
        },
      ],
      submarket: "West Cook",
      varianceAbsolute: 82_000,
      period: "2026 Q2",
      scope: "Eligible 20K+ Market Universe",
      knownDifference: true,
    });
    expect(result.determination).toBe("known-difference");
    expect(result.records[0]?.buildingSf).toBe(82_000);
  });
});
