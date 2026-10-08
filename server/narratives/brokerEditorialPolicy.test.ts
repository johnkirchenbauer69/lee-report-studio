import { describe, expect, it } from "vitest";
import { BROKER_INTERVIEW_POLICY } from "../../src/report-engine/narratives/brokerInterviews.ts";
import type { NarrativeContext } from "../../src/report-engine/narratives/schema.ts";
import { narrativeHandoffPrompt } from "./NarrativeMcpBridgeClient.ts";
import { narrativePrompt } from "./prompts.ts";
import { NARRATIVE_PUBLICATION_STYLE } from "../../src/report-engine/narratives/publicationStyle.ts";
import { NARRATIVE_EDITORIAL_RULES } from "./contextBuilder.ts";

const context: NarrativeContext = {
  marketId: "fox-valley", marketName: "Fox Valley", marketKind: "submarket",
  period: "2026 Q3", promptVersion: "submarket-v3", contextHash: "test", facts: [],
};
const enriched: NarrativeContext = {
  ...context,
  brokerContext: {
    sourceType: "BROKER_INTERVIEW_CONTEXT",
    observations: [{
      contextKey: "broker.fox-valley.tenant_activity.1", topic: "tenant_activity",
      statement: "Activity is stronger among mid-sized users.",
      evidenceClass: "broker_observation", publicationSafe: true,
      sourceLabel: "Broker Interview Context",
    }],
  },
};

describe("broker editorial policy on both generation paths", () => {
  it.each([false, true])("prohibits dataset-boundary prose with broker coverage %s on both paths", (broker) => {
    const direct = narrativePrompt(broker ? enriched : context).instructions;
    const handoff = narrativeHandoffPrompt("test-job", { brokerContext: broker });
    expect(NARRATIVE_EDITORIAL_RULES).toContain(NARRATIVE_PUBLICATION_STYLE);
    for (const instructions of [direct, handoff]) {
      expect(instructions).toContain(NARRATIVE_PUBLICATION_STYLE);
      for (const phrase of ["available history", "available series", "supplied history", "provided data"])
        expect(instructions).toContain(`"${phrase}"`);
      expect(instructions).toContain("Do not use or paraphrase");
      expect(instructions).toContain("explicitly supported by governed context");
      expect(instructions).toContain("since 2023 Q4");
      expect(instructions).toContain("omit the superlative");
    }
  });
  const paths = [
    ["direct", narrativePrompt(enriched).instructions],
    ["handoff", narrativeHandoffPrompt("test-job", { brokerContext: true })],
  ] as const;
  for (const [name, instructions] of paths) {
    it(`${name}: preserves the governed thesis and stronger analysis`, () => {
      expect(instructions).toContain(BROKER_INTERVIEW_POLICY);
      expect(instructions).toContain("first determine the strongest governed thesis");
      expect(instructions).toContain("Preserve that data-driven narrative as the base");
      expect(instructions).toContain("never replace stronger analysis");
      expect(instructions).toContain("transaction-level explanations, historical comparisons, governed drivers");
    });
    it(`${name}: makes enrichment sparse and optional within existing limits`, () => {
      for (const text of ["0 to 3 broker-derived sentences", "no more than one passage", "25%",
        "not quotas", "Do not force broker commentary into every covered market",
        "use little or none when redundant", "Keep the existing word limits"])
        expect(instructions).toContain(text);
    });
    it(`${name}: uses natural attribution and direct observational prose`, () => {
      expect(instructions).toContain("The data reflects what we are hearing from our brokers.");
      expect(instructions).toContain("Our brokers are seeing...");
      expect(instructions).toContain("avoid repeated 'broker feedback', 'brokers reported'");
      expect(instructions).toContain("State the insight directly in observational language");
      expect(instructions).toContain("Our brokers are seeing limited purchase options and more interest in build-to-suit opportunities.");
    });
    it(`${name}: prohibits methodology language and evidence disclaimers in publication prose`, () => {
      expect(instructions).toContain("Publication prose must never explain or paraphrase evidence handling");
      const prohibition = instructions.slice(instructions.indexOf("Prohibited publication language includes:"),
        instructions.indexOf("These concepts belong only"));
      for (const phrase of ["qualitative layer", "qualitative view", "qualitative tone",
        "should be balanced against", "governed picture", "governed record",
        "quantified supply conclusion", "those observations fit", "that commentary is consistent with"])
        expect(prohibition).toContain(`'${phrase}'`);
      expect(instructions).toContain("Do not append evidence disclaimers");
      expect(instructions).toContain("the prose must not explain the guardrails");
    });
    it(`${name}: allows supported natural contrast without weakening grounding`, () => {
      expect(instructions).toContain("retain the observation with natural attribution");
      expect(instructions).toContain("although vacancy moved modestly higher during the quarter");
      for (const rule of ["They can never establish an objective cause", "same claim also cites a governed market_driver fact",
        "evidenceClass interpretive", "A broker contextKey never supports a number",
        "Never include restricted, confidential, uncertain, or review-required observations",
        "never borrow commentary from another market", "at least two different submarkets"])
        expect(instructions).toContain(rule);
    });
  }

  it("leaves the no-broker direct prompt and handoff unchanged by the optional policy", () => {
    const plain = narrativePrompt(context);
    const withBroker = narrativePrompt(enriched);
    expect(withBroker.instructions).toBe(`${plain.instructions}\n\n${BROKER_INTERVIEW_POLICY}`);
    expect(JSON.parse(plain.input).context).not.toHaveProperty("brokerContext");
    expect(JSON.parse(withBroker.input).context.brokerContext).toEqual(enriched.brokerContext);
    expect(narrativeHandoffPrompt("test-job", { brokerContext: true }))
      .toBe(`${narrativeHandoffPrompt("test-job")}\n\n${BROKER_INTERVIEW_POLICY}`);
    expect(plain.instructions).not.toContain("Broker interview context");
    expect(BROKER_INTERVIEW_POLICY).toContain("Markets without brokerContext retain the existing governed-only writing approach unchanged");
  });
});
