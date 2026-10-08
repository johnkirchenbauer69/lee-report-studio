import { describe, expect, it } from "vitest";
import type {
  NarrativeContext,
  NarrativeContextFact,
  NarrativeGenerationResult,
} from "../../src/report-engine/narratives/schema.ts";
import { validateNarrativeResult } from "./validation.ts";

const fact = (
  input: Partial<NarrativeContextFact> &
    Pick<NarrativeContextFact, "contextKey" | "category" | "displayValue">,
): NarrativeContextFact => ({
  label: input.contextKey,
  value: input.displayValue,
  sourceType: "Report_Data_Service",
  authority: "test",
  publicationSafe: true,
  ...input,
});

const indicators = ["market_indicators" as const];

const baseFacts: NarrativeContextFact[] = [
  fact({ contextKey: "metric.vacancy.current", category: "metric", displayValue: "6.0%", visibleOn: indicators }),
  fact({ contextKey: "metric.availability.current", category: "metric", displayValue: "8.4%", visibleOn: indicators }),
  fact({ contextKey: "metric.net_absorption.current", category: "metric", displayValue: "+120,000 SF", visibleOn: indicators }),
  fact({ contextKey: "metric.leasing_activity.current", category: "metric", displayValue: "1.4 million SF", visibleOn: indicators }),
  fact({ contextKey: "metric.under_construction.current", category: "metric", displayValue: "650,000 SF", visibleOn: indicators }),
  fact({ contextKey: "metric.sales_volume.current", category: "metric", displayValue: "$1.19 billion" }),
  fact({ contextKey: "metric.asking_rent.current", category: "metric", displayValue: "$8.18/SF" }),
  fact({ contextKey: "metric.vacancy.qoq_bps", category: "trend", displayValue: "up 50 basis points" }),
  fact({ contextKey: "lease.1", category: "lease", displayValue: "Alpha Foods · 600,000 SF", entityNames: ["Alpha Foods"], visibleOn: ["top_leases"], editorialPriority: "supporting" }),
  fact({ contextKey: "lease.2", category: "lease", displayValue: "Beta Logistics · 300,000 SF", entityNames: ["Beta Logistics"], visibleOn: ["top_leases"], editorialPriority: "supporting" }),
  fact({ contextKey: "lease.3", category: "lease", displayValue: "Gamma Retail · 280,000 SF", entityNames: ["Gamma Retail"], visibleOn: ["top_leases"], editorialPriority: "supporting" }),
];

const context = (facts: NarrativeContextFact[] = baseFacts): NarrativeContext => ({
  marketId: "central-dupage",
  marketName: "Central DuPage",
  marketKind: "submarket",
  period: "2026 Q2",
  promptVersion: "submarket-v3",
  contextHash: "hash",
  facts,
});

const result = (narrative: string): NarrativeGenerationResult => ({
  narrative,
  claims: [{ claim: "Vacancy rose.", supportKeys: ["metric.vacancy.current"], evidenceClass: "direct" }],
  contextKeysUsed: ["metric.vacancy.current"],
  qualityFlags: [],
});

const flags = (narrative: string, facts?: NarrativeContextFact[]) =>
  validateNarrativeResult(context(facts), result(narrative)).qualityFlags;

const CLEAN =
  "Demand softened in Central DuPage as vacancy rose despite positive quarterly net absorption, a divergence that left the submarket looser than a quarter earlier. Leasing remained steady, and Alpha Foods accounted for the quarter's most consequential commitment.\n\nDevelopment stayed measured, keeping new supply from adding pressure.";

describe("context v3 editorial QA flags", () => {
  it("leaves a thesis-led, page-aware narrative unflagged", () => {
    const output = flags(CLEAN);
    for (const flag of [
      "transaction_repetition",
      "weak_thesis",
      "unsupported_outlook",
      "excessive_metric_density",
      "page_redundancy",
      "generic_closing",
      "unsupported_causal_claim",
    ])
      expect(output).not.toContain(flag);
  });

  it("flags a repetitive transaction dump", () => {
    expect(
      flags(
        "Leasing concentrated in large commitments this quarter. Alpha Foods signed 600,000 SF. Beta Logistics signed 300,000 SF. Gamma Retail signed 280,000 SF.",
      ),
    ).toContain("transaction_repetition");
  });

  it("flags two transactions that only restate the Top Leases table", () => {
    expect(
      flags(
        "Demand strengthened through the quarter. Alpha Foods and Beta Logistics completed the largest leases.",
      ),
    ).toContain("transaction_repetition");
  });

  it("flags a number-led opening without a thesis", () => {
    expect(
      flags("Vacancy was 6.0%, availability was 8.4%, and absorption totaled +120,000 SF. Demand held."),
    ).toContain("weak_thesis");
  });

  it("flags unsupported outlook but allows governed pipeline-backed statements", () => {
    expect(flags(`${CLEAN} Conditions are expected to tighten in the coming quarters.`)).toContain(
      "unsupported_outlook",
    );
    const withPipeline = [
      ...baseFacts,
      fact({ contextKey: "governed.pipeline_change.1", category: "market_driver", displayValue: "Two projects totaling 650,000 SF are scheduled to deliver in 2026 Q4", analyticalType: "pipeline_change", causalSupport: true }),
    ];
    expect(
      flags(`${CLEAN} The construction pipeline is expected to deliver 650,000 SF.`, withPipeline),
    ).not.toContain("unsupported_outlook");
  });

  it("flags excessive metric density", () => {
    expect(
      flags(
        "Demand softened as vacancy reached 6.0%, availability 8.4%, absorption +120,000 SF, and leasing 1.4 million SF. Supply shifted.",
      ),
    ).toContain("excessive_metric_density");
  });

  it("flags page redundancy when headline values visible on the page are recited", () => {
    expect(
      flags(
        "Demand softened this quarter. Vacancy stood at 6.0% and availability at 8.4%. Net absorption came to +120,000 SF. Leasing reached 1.4 million SF.",
      ),
    ).toContain("page_redundancy");
  });

  it("flags a generic concluding sentence", () => {
    expect(
      flags(`${CLEAN} Overall, the submarket remains well positioned for the remainder of the year.`),
    ).toContain("generic_closing");
  });

  it("flags causal wording when no governed driver licenses it", () => {
    expect(
      flags("Demand softened. Vacancy rose because second-generation space returned to the market. Supply held."),
    ).toContain("unsupported_causal_claim");
    const governed = [
      ...baseFacts,
      fact({ contextKey: "governed.vacancy_bridge.1", category: "market_driver", displayValue: "Second-generation space returned 300,000 SF", analyticalType: "vacancy_bridge", causalSupport: true, evidenceStrength: "strong" }),
    ];
    expect(
      flags("Demand softened. Vacancy rose because second-generation space returned to the market. Supply held.", governed),
    ).not.toContain("unsupported_causal_claim");
  });

  it("flags repeated 'while' contrasts and overused connective verbs", () => {
    const output = flags(
      "While vacancy rose, demand held. While leasing slowed, absorption stayed positive. Construction eased, while availability edged up, underscoring a balanced market and highlighting resilience.",
    );
    expect(output).toContain("repetitive_sentence_structure");
    expect(output).toContain("boilerplate_phrasing");
  });

  it("never turns editorial QA into a blocking error", () => {
    const validation = validateNarrativeResult(
      context(),
      result("Vacancy was 6.0%, availability was 8.4%, and absorption totaled +120,000 SF. Overall, the market remains well positioned."),
    );
    expect(validation.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });
});

describe("billion and rent formatting in numeric grounding", () => {
  it("matches a billion-dollar figure and a $/SF rent to governed display values", () => {
    const validation = validateNarrativeResult(
      context(),
      result("Investment activity firmed, with sales volume reaching $1.19 billion while asking rents held at $8.18/SF."),
    );
    expect(validation.issues.filter((issue) => issue.kind === "numeric")).toEqual([]);
  });

  it("still warns on a billion-dollar figure the context does not support", () => {
    const validation = validateNarrativeResult(
      context(),
      result("Investment activity firmed, with sales volume reaching $2.4 billion."),
    );
    expect(validation.qualityFlags).toContain("numeric_validation_warning");
  });
});
