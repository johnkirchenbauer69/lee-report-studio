import { describe, expect, it } from "vitest";
import type { NarrativeContext, NarrativeGenerationResult } from "../../src/report-engine/narratives/schema.ts";
import { validateNarrativeResult } from "./validation.ts";

const context: NarrativeContext = {
  marketId: "central-dupage",
  marketName: "Central DuPage",
  marketKind: "submarket",
  period: "2026 Q2",
  promptVersion: "submarket-v1",
  contextHash: "abc",
  facts: [
    { contextKey: "metric.vacancy.current", category: "metric", label: "Vacancy", value: 0.048, displayValue: "4.8%", sourceType: "Market_Data__c", authority: "official", publicationSafe: true },
    { contextKey: "lease.1", category: "lease", label: "Known Tenant", value: 400_000, displayValue: "Known Tenant · 400,000 SF", sourceType: "Market_Data_Contributor__c", authority: "finalist", publicationSafe: true, entityNames: ["Known Tenant"] },
  ],
};
const valid = (narrative = "Vacancy was 4.8% alongside a 400,000 SF lease by Known Tenant."): NarrativeGenerationResult => ({
  narrative,
  claims: [{ claim: "Vacancy was 4.8%.", supportKeys: ["metric.vacancy.current"], evidenceClass: "direct" }],
  contextKeysUsed: ["metric.vacancy.current", "lease.1"],
  qualityFlags: [],
});

describe("validateNarrativeResult", () => {
  it("accepts grounded support keys, numbers, and entities", () => {
    expect(validateNarrativeResult(context, valid()).issues).toEqual([]);
  });

  it("rejects unknown support keys", () => {
    const result = valid();
    result.claims[0]!.supportKeys = ["lease.99"];
    expect(validateNarrativeResult(context, result).issues).toContainEqual(
      expect.objectContaining({ kind: "support", severity: "error" }),
    );
  });

  it("rejects hallucinated entities and numeric facts", () => {
    const issues = validateNarrativeResult(
      context,
      valid("Acme Logistics completed a 900,000 SF lease while vacancy reached 9.9%."),
    ).issues;
    expect(issues.some((item) => item.kind === "entity")).toBe(true);
    expect(issues.filter((item) => item.kind === "numeric")).toHaveLength(2);
  });

  it("flags an ambiguous nearby rounded value for review", () => {
    const validation = validateNarrativeResult(
      context,
      valid("Known Tenant signed a 440,000 SF lease while vacancy was 4.8%."),
    );
    expect(validation.issues).toContainEqual(
      expect.objectContaining({ kind: "numeric", severity: "warning" }),
    );
    expect(validation.qualityFlags).toContain("numeric_validation_warning");
  });

  it("enforces the hard word limit", () => {
    const issues = validateNarrativeResult(context, valid(Array(162).fill("market").join(" "))).issues;
    expect(issues).toContainEqual(expect.objectContaining({ kind: "length", severity: "error" }));
  });
});
