import { describe, expect, it } from "vitest";
import { q2SampleReport } from "../../data-providers/sample/q2SampleReport";
import type { ProvenanceRecord } from "../schema/industrialMarketReport";
import { validateNormalizedReport } from "./reportValidation";

const path = "reconciliation.submarkets.West Cook.inventorySf";

const issuesFor = (
  reconciliation: NonNullable<ProvenanceRecord["reconciliation"]>,
) => {
  const report = structuredClone(q2SampleReport);
  report.provenance.push({
    fieldPath: path,
    selectedValue: reconciliation.authoritativeValue,
    sources: [
      {
        sourceId: "market-data-west-cook",
        sourceType: "salesforce",
        value: reconciliation.authoritativeValue,
        reference: "Market_Data__c.Inventory_SF__c",
      },
      {
        sourceId: "property-data-west-cook",
        sourceType: "calculated",
        value: reconciliation.comparisonValue,
        reference: "SUM(Property_Data__c.Inventory_SF__c)",
      },
    ],
    authority: "Market_Data__c official submarket snapshot",
    status:
      reconciliation.classification === "matched"
        ? "matched"
        : reconciliation.classification === "known-difference"
          ? "reconciled"
          : "conflict",
    critical: reconciliation.classification === "blocking",
    note: `${reconciliation.reason} Authoritative: ${reconciliation.authoritativeValue}; Property_Data: ${reconciliation.comparisonValue}; absolute variance: ${reconciliation.varianceAbsolute}; percentage variance: ${reconciliation.variancePercentage}.`,
    reconciliation,
  });
  return validateNormalizedReport(report, { provider: "sample" }).filter(
    (issue) => issue.path === path,
  );
};

describe("reconciliation readiness severity", () => {
  it("emits no issue for an exact match", () => {
    expect(
      issuesFor({
        classification: "matched",
        authoritativeValue: 66_346_013,
        comparisonValue: 66_346_013,
        varianceAbsolute: 0,
        variancePercentage: 0,
        reason: "Matched.",
      }),
    ).toEqual([]);
  });

  it("keeps an approved known difference visible as a warning", () => {
    expect(
      issuesFor({
        classification: "known-difference",
        authoritativeValue: 66_346_013,
        comparisonValue: 66_411_213,
        varianceAbsolute: 65_200,
        variancePercentage: 65_200 / 66_346_013,
        reason: "Approved known difference.",
      }),
    ).toEqual([
      expect.objectContaining({
        level: "warning",
        message: expect.stringContaining("absolute variance: 65200"),
      }),
    ]);
  });

  it("keeps a material unexplained difference blocking", () => {
    expect(
      issuesFor({
        classification: "blocking",
        authoritativeValue: 100_000_000,
        comparisonValue: 105_000_000,
        varianceAbsolute: 5_000_000,
        variancePercentage: 0.05,
        reason: "Material unexplained variance.",
      }),
    ).toEqual([expect.objectContaining({ level: "blocking" })]);
  });

  it("keeps a missing authoritative value blocking", () => {
    expect(
      issuesFor({
        classification: "blocking",
        authoritativeValue: null,
        comparisonValue: 66_411_213,
        varianceAbsolute: null,
        variancePercentage: null,
        reason: "Authoritative Market_Data inventory is missing.",
      }),
    ).toEqual([expect.objectContaining({ level: "blocking" })]);
  });
});
