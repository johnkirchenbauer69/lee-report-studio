import type { SalesforceRecord } from "../salesforce/SalesforceClient.ts";
import { canonicalChicagoSubmarket } from "./salesforceFieldMap.ts";

const numeric = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const text = (value: unknown) => String(value ?? "").trim();
const relation = (row: SalesforceRecord) =>
  (row.Property__r as SalesforceRecord | undefined) ?? ({} as SalesforceRecord);

export interface InventoryReconciliationDetails {
  determination:
    "candidate-match" | "candidate-set" | "aggregate-only" | "known-difference";
  explanation: string;
  sourceCriteria: string[];
  includedRecordCount: number;
  candidateTotalSf: number;
  diagnosticOnly: true;
  records: Array<{
    propertyDataId: string;
    propertyId: string | null;
    property: string;
    address: string | null;
    buildingSf: number;
    canonicalSubmarket: string;
    includedInPropertyDataAggregation: boolean;
    expectedOfficialScope: boolean | null;
    classification: "candidate" | "context";
    reason: string;
  }>;
}

const findCandidateIndexes = (values: number[], target: number) => {
  const singles = values.flatMap((value, index) =>
    Math.abs(value - target) <= 1 ? [[index]] : [],
  );
  if (singles.length) return singles[0]!;
  const seen = new Map<number, number>();
  for (let index = 0; index < values.length; index += 1) {
    const needed = Math.round(target - values[index]!);
    const other = seen.get(needed);
    if (other != null) return [other, index];
    seen.set(Math.round(values[index]!), index);
  }
  return [];
};

export function buildInventoryReconciliationDetails(input: {
  rows: SalesforceRecord[];
  submarket: string;
  varianceAbsolute: number;
  period: string;
  scope: string;
  knownDifference?: boolean;
}): InventoryReconciliationDetails {
  const scoped = input.rows.filter(
    (row) =>
      canonicalChicagoSubmarket(text(row.Submarket__c)) === input.submarket,
  );
  const candidateIndexes = findCandidateIndexes(
    scoped.map((row) => numeric(row.Inventory_SF__c)),
    input.varianceAbsolute,
  );
  const candidates = new Set(candidateIndexes);
  const selected = candidateIndexes.length
    ? scoped.filter((_, index) => candidates.has(index))
    : [...scoped]
        .sort((a, b) => numeric(b.Inventory_SF__c) - numeric(a.Inventory_SF__c))
        .slice(0, 25);
  const determination = input.knownDifference
    ? "known-difference"
    : candidateIndexes.length === 1
      ? "candidate-match"
      : candidateIndexes.length > 1
        ? "candidate-set"
        : "aggregate-only";
  const cannotProve =
    "Market_Data provides an authoritative aggregate, not property-level official scope; this record is a deterministic candidate, not a proven exclusion.";
  return {
    determination,
    explanation:
      determination === "aggregate-only"
        ? "No one- or two-record Property_Data candidate exactly equals the variance. The largest included records are shown as the smallest available diagnostic context."
        : determination === "known-difference"
          ? "This variance is an approved known reconciliation finding. Candidate records remain diagnostic and do not replace Market_Data."
          : `${candidateIndexes.length === 1 ? "One included Property_Data record" : "A two-record Property_Data set"} equals the aggregate variance. ${cannotProve}`,
    sourceCriteria: [
      `Quarter__c = ${input.period}`,
      `Property_Data_Scope__c = ${input.scope}`,
      `Canonical Submarket = ${input.submarket}`,
      "Aggregation = SUM(Property_Data__c.Inventory_SF__c)",
      "Operation = read-only Salesforce query; no writeback",
    ],
    includedRecordCount: scoped.length,
    candidateTotalSf: selected.reduce(
      (total, row) => total + numeric(row.Inventory_SF__c),
      0,
    ),
    diagnosticOnly: true,
    records: selected.map((row, index) => {
      const property = relation(row);
      const address = [
        text(property.ascendix__Street__c),
        text(property.ascendix__City__c),
        text(property.State__c),
      ]
        .filter(Boolean)
        .join(", ");
      const isCandidate = candidateIndexes.length > 0;
      return {
        propertyDataId: text(row.Id) || `property-data-row-${index + 1}`,
        propertyId: text(row.Property__c) || null,
        property:
          text(property.Name) || text(row.Name) || "Property name unavailable",
        address: address || null,
        buildingSf: numeric(row.Inventory_SF__c),
        canonicalSubmarket: input.submarket,
        includedInPropertyDataAggregation: true,
        expectedOfficialScope: null,
        classification: isCandidate ? "candidate" : "context",
        reason: isCandidate
          ? cannotProve
          : "Included by the current Property_Data quarter, eligible-scope, and canonical-submarket filters; no exact aggregate candidate was found.",
      };
    }),
  };
}
