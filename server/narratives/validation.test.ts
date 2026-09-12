import { describe, expect, it } from "vitest";
import type { NarrativeContext, NarrativeGenerationResult } from "../../src/report-engine/narratives/schema.ts";
import { detectRepeatedBatchOpenings, validateNarrativeResult } from "./validation.ts";

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
    { contextKey: "metric.net_absorption.qoq_change_sf", category: "trend", label: "Net absorption QoQ", value: -20_000, displayValue: "-20,000 SF", sourceType: "Report_Data_Service", authority: "test", publicationSafe: true },
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

  // Real market names carry digits and slashes. A character class that
  // excluded them truncated "I-55" to "I-" and rejected correct prose:
  // ChatGPT's first live batch failed on exactly these four markets.
  it.each([
    ["i55-corridor", "I-55 Corridor", "The I-55 Corridor closed 2026 Q2 with vacancy at 4.8%."],
    ["i57-corridor", "I-57 Corridor", "The I-57 Corridor ended 2026 Q2 with vacancy at 4.8%."],
    ["i80-joliet", "I-80/Joliet Area", "The I-80/Joliet Area closed 2026 Q2 with vacancy at 4.8%."],
    ["i88-corridor", "I-88 Corridor", "The I-88 Corridor ended 2026 Q2 with vacancy at 4.8%."],
  ])("accepts prose naming %s, whose name contains digits or a slash", (marketId, marketName, narrative) => {
    const corridor: NarrativeContext = { ...context, marketId, marketName };
    const issues = validateNarrativeResult(corridor, {
      narrative,
      claims: [
        {
          claim: "Vacancy was 4.8%.",
          supportKeys: ["metric.vacancy.current"],
          evidenceClass: "direct",
        },
      ],
      contextKeysUsed: ["metric.vacancy.current"],
      qualityFlags: [],
    }).issues;
    expect(issues.filter((item) => item.kind === "entity")).toEqual([]);
  });

  it("still rejects a hallucinated entity that contains digits", () => {
    const corridor: NarrativeContext = {
      ...context,
      marketId: "i55-corridor",
      marketName: "I-55 Corridor",
    };
    const issues = validateNarrativeResult(
      corridor,
      valid("The I-99 Corridor closed 2026 Q2 with vacancy at 4.8%."),
    ).issues;
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: "entity", severity: "error" }),
    );
  });

  it("rejects an em dash as a blocking publication-style error", () => {
    const issues = validateNarrativeResult(
      context,
      valid("Demand improved — particularly in larger blocks."),
    ).issues;
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: "style", severity: "error" }),
    );
  });

  it.each([
    "Demand improved year-over-year.",
    "Build-to-suit activity increased.",
    "The submarket recorded -20,000 SF of absorption this quarter.",
    "A 500,000-square-foot facility delivered this quarter.",
  ])("does not flag ordinary hyphens or negative numbers as em dashes: %s", (narrative) => {
    const issues = validateNarrativeResult(context, valid(narrative)).issues;
    expect(issues.filter((issue) => issue.kind === "style")).toEqual([]);
  });

  it("enforces the hard word limit", () => {
    const issues = validateNarrativeResult(context, valid(Array(277).fill("market").join(" "))).issues;
    expect(issues).toContainEqual(expect.objectContaining({ kind: "length", severity: "error" }));
  });

  it("accepts a multi-paragraph narrative", () => {
    const narrative = [
      "Central DuPage's story this quarter was accelerating demand. Vacancy was 4.8% alongside a 400,000 SF lease by Known Tenant.",
      "That improvement outpaced the broader region and reflects a sustained trend of tightening conditions.",
    ].join("\n\n");
    const issues = validateNarrativeResult(context, valid(narrative)).issues;
    expect(issues).toEqual([]);
  });

  it("rejects internal workflow language", () => {
    const issues = validateNarrativeResult(
      context,
      valid("Vacancy was 4.8% for a lease still waiting for comp confirmation."),
    ).issues;
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: "workflow", severity: "error" }),
    );
  });

  it.each(["Salesforce", "Ascendix", "a finalist lease", "the provenance record", "a support key"])(
    "rejects %s as internal language",
    (phrase) => {
      const issues = validateNarrativeResult(
        context,
        valid(`Vacancy was 4.8% according to ${phrase}.`),
      ).issues;
      expect(issues).toContainEqual(
        expect.objectContaining({ kind: "workflow", severity: "error" }),
      );
    },
  );

  it("rejects markdown bullets and headings", () => {
    const bulleted = validateNarrativeResult(
      context,
      valid("Overview:\n- Vacancy was 4.8%.\n- Leasing was strong."),
    ).issues;
    expect(bulleted).toContainEqual(
      expect.objectContaining({ kind: "formatting", severity: "error" }),
    );
    const headed = validateNarrativeResult(
      context,
      valid("## Overview\nVacancy was 4.8% alongside a 400,000 SF lease by Known Tenant."),
    ).issues;
    expect(headed).toContainEqual(
      expect.objectContaining({ kind: "formatting", severity: "error" }),
    );
  });

  it("flags a formulaic market-name opening as a non-blocking quality flag", () => {
    const validation = validateNarrativeResult(
      context,
      valid("Central DuPage closed 2026 Q2 with vacancy at 4.8% alongside a 400,000 SF lease by Known Tenant."),
    );
    expect(validation.issues).toEqual([]);
    expect(validation.qualityFlags).toContain("template_opening");
  });

  it("flags a bare metric-first opening as a non-blocking quality flag", () => {
    const validation = validateNarrativeResult(context, valid());
    expect(validation.qualityFlags).toContain("template_opening");
  });

  it("does not flag an opening that leads with the market story", () => {
    const validation = validateNarrativeResult(
      context,
      valid("Demand strengthened again this quarter, led by a 400,000 SF lease from Known Tenant."),
    );
    expect(validation.qualityFlags).not.toContain("template_opening");
  });

  it("flags a metric dump when most sentences are bare metric recitations", () => {
    const narrative = [
      "Vacancy was 4.8%.",
      "Availability was steady.",
      "Net absorption was positive.",
      "Sales volume was moderate.",
      "The submarket was resilient.",
    ].join(" ");
    const validation = validateNarrativeResult(context, valid(narrative));
    expect(validation.qualityFlags).toContain("metric_dump");
    expect(validation.qualityFlags).toContain("repetitive_sentence_structure");
  });

  it("does not flag interpretive prose as a metric dump", () => {
    const narrative = [
      "Central DuPage's quarter was defined by accelerating occupier demand.",
      "Known Tenant's 400,000 SF lease illustrated that momentum, and vacancy fell to 4.8% as a result.",
      "That improvement compares favorably with the submarket's recent trend.",
    ].join(" ");
    const validation = validateNarrativeResult(context, valid(narrative));
    expect(validation.qualityFlags).not.toContain("metric_dump");
    expect(validation.qualityFlags).not.toContain("repetitive_sentence_structure");
  });

  it("flags overused boilerplate connective phrases", () => {
    const narrative =
      "Sales volume totaled a modest sum. The submarket also had steady leasing. Sales volume totaled a modest sum again next door.";
    const validation = validateNarrativeResult(context, valid(narrative));
    expect(validation.qualityFlags).toContain("boilerplate_phrasing");
  });

  it("flags a missing comparative statement when trend history is available but unused", () => {
    const trendContext: NarrativeContext = {
      ...context,
      facts: [
        ...context.facts,
        {
          contextKey: "metric.vacancy.yoy_bps",
          category: "trend",
          label: "Vacancy YoY",
          value: -80,
          displayValue: "down 80 basis points",
          sourceType: "Report_Data_Service",
          authority: "test",
          publicationSafe: true,
        },
      ],
    };
    const validation = validateNarrativeResult(
      trendContext,
      valid("Vacancy was 4.8% alongside a 400,000 SF lease by Known Tenant."),
    );
    expect(validation.qualityFlags).toContain("missing_comparative_context");
  });

  it("does not flag missing comparative context when trend history is used", () => {
    const trendContext: NarrativeContext = {
      ...context,
      facts: [
        ...context.facts,
        {
          contextKey: "metric.vacancy.yoy_bps",
          category: "trend",
          label: "Vacancy YoY",
          value: -80,
          displayValue: "down 80 basis points",
          sourceType: "Report_Data_Service",
          authority: "test",
          publicationSafe: true,
        },
      ],
    };
    const validation = validateNarrativeResult(
      trendContext,
      valid("Vacancy fell year-over-year to 4.8% alongside a 400,000 SF lease by Known Tenant."),
    );
    expect(validation.qualityFlags).not.toContain("missing_comparative_context");
  });
});

describe("detectRepeatedBatchOpenings", () => {
  it("flags markets whose opening words recur across the batch", () => {
    const flagged = detectRepeatedBatchOpenings([
      { marketId: "a", text: "Vacancy finished the quarter at 4.8%." },
      { marketId: "b", text: "Vacancy finished the quarter at 5.1%." },
      { marketId: "c", text: "Vacancy finished the quarter at 6.0%." },
      { marketId: "d", text: "Leasing strengthened sharply this quarter." },
    ]);
    expect(flagged).toEqual(new Set(["a", "b", "c"]));
  });

  it("does not flag a batch with varied openings", () => {
    const flagged = detectRepeatedBatchOpenings([
      { marketId: "a", text: "Vacancy finished the quarter at 4.8%." },
      { marketId: "b", text: "Leasing activity accelerated sharply." },
      { marketId: "c", text: "A single large sale defined the quarter." },
    ]);
    expect(flagged.size).toBe(0);
  });

  it("ignores markets with no text yet", () => {
    const flagged = detectRepeatedBatchOpenings([
      { marketId: "a", text: "" },
      { marketId: "b", text: "" },
      { marketId: "c", text: "" },
    ]);
    expect(flagged.size).toBe(0);
  });
});
