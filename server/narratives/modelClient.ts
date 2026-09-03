import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  narrativeGenerationResultSchema,
  type NarrativeContext,
  type NarrativeGenerationResult,
  type NarrativeUsage,
} from "../../src/report-engine/narratives/schema.ts";
import { narrativePrompt } from "./prompts.ts";

export interface NarrativeModelResponse {
  result: NarrativeGenerationResult;
  model: string;
  usage?: NarrativeUsage;
}

export interface NarrativeModelClient {
  readonly configured: boolean;
  readonly model: string;
  generate(
    context: NarrativeContext,
    instruction?: string,
  ): Promise<NarrativeModelResponse>;
}

export const DEFAULT_NARRATIVE_MODEL = "gpt-5.6-terra";

export class OpenAINarrativeModelClient implements NarrativeModelClient {
  readonly configured: boolean;
  readonly model: string;
  private readonly client?: OpenAI;

  constructor(options: { apiKey?: string; model?: string } = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    this.model =
      options.model ?? process.env.OPENAI_NARRATIVE_MODEL ?? DEFAULT_NARRATIVE_MODEL;
    this.configured = Boolean(apiKey);
    if (apiKey)
      this.client = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 2 });
  }

  async generate(context: NarrativeContext, instruction?: string) {
    if (!this.client)
      throw new Error("AI narrative generation is not configured.");
    const prompt = narrativePrompt(context, instruction);
    const response = await this.client.responses.parse({
      model: this.model,
      instructions: prompt.instructions,
      input: prompt.input,
      store: false,
      tools: [],
      reasoning: { effort: "low" },
      max_output_tokens: 2_500,
      text: {
        format: zodTextFormat(
          narrativeGenerationResultSchema,
          "lee_market_narrative",
        ),
      },
    });
    if (!response.output_parsed) {
      const refused = response.output.some(
        (item) =>
          "content" in item &&
          item.content?.some((content) => content.type === "refusal"),
      );
      throw new Error(
        refused
          ? "The narrative model refused the request. Review the context and retry."
          : response.status === "incomplete"
          ? "The narrative response was incomplete."
          : "The narrative model did not return valid structured output.",
      );
    }
    return {
      result: response.output_parsed,
      model: response.model,
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          }
        : undefined,
    };
  }
}

const display = (context: NarrativeContext, key: string) =>
  context.facts.find((item) => item.contextKey === key)?.displayValue;

export class MockNarrativeModelClient implements NarrativeModelClient {
  readonly configured = true;
  readonly model = "mock-narrative-v1";
  constructor(
    private readonly failMarketIds = new Set<string>(),
  ) {}

  async generate(context: NarrativeContext): Promise<NarrativeModelResponse> {
    if (this.failMarketIds.has(context.marketId))
      throw new Error("Deterministic mock generation failure.");
    const vacancy = display(context, "metric.vacancy.current") ?? "the reported level";
    const vacancyChange = display(context, "metric.vacancy.qoq_bps") ?? "broadly steady";
    const absorption = display(context, "metric.net_absorption.current") ?? "the reported quarterly result";
    const construction = display(context, "metric.under_construction.current") ?? "the current pipeline";
    const transaction = context.facts.find((item) =>
      ["lease", "sale", "availability", "construction", "delivery"].includes(item.category),
    );
    const ranking = context.facts.find((item) => item.category === "ranking");
    const supportKeys = [
      "metric.vacancy.current",
      "metric.net_absorption.current",
      ...(context.facts.some((item) => item.contextKey === "metric.vacancy.qoq_bps")
        ? ["metric.vacancy.qoq_bps"]
        : []),
    ];
    const contextDetails = [ranking?.displayValue, transaction?.displayValue]
      .filter(Boolean)
      .join(". ");
    const narrative = context.marketKind === "overall"
      ? `Chicago industrial fundamentals remained measured during ${context.period}, with quarterly net absorption of ${absorption} and vacancy at ${vacancy}, ${vacancyChange} from the prior quarter. Performance continued to vary by geography rather than moving uniformly across the region. ${contextDetails ? `${contextDetails}. ` : ""}The ${construction} construction pipeline provides important supply context, while the quarter's transaction activity remained concentrated in a limited number of material properties. Taken together, the governed metrics indicate a market balancing current demand against selective new supply, with submarket-level results carrying more explanatory weight than the aggregate alone.`
      : `${context.marketName} recorded quarterly net absorption of ${absorption} during ${context.period}, while vacancy finished at ${vacancy}, ${vacancyChange} from the prior quarter. ${contextDetails ? `${contextDetails}. ` : ""}The local result reflects the interaction between current occupier activity and available space rather than a single unsupported cause. With ${construction} under construction, the near-term supply picture remains an important consideration alongside leasing and availability conditions. The quarter therefore presents a measured local story: current fundamentals are supported by the reported activity, but conclusions beyond the verified transactions and governed market metrics would be premature.`;
    const claims = [
      {
        claim: `${context.marketName} recorded ${absorption} of quarterly net absorption with vacancy at ${vacancy}.`,
        supportKeys,
        evidenceClass: "direct" as const,
      },
      ...(transaction
        ? [{
            claim: `A material ${transaction.category} record provided transaction context.`,
            supportKeys: [transaction.contextKey],
            evidenceClass: "direct" as const,
          }]
        : []),
    ];
    return {
      model: this.model,
      result: {
        narrative,
        claims,
        contextKeysUsed: [...new Set(claims.flatMap((claim) => claim.supportKeys))],
        qualityFlags: [
          ...(context.facts.some((item) => item.category === "driver")
            ? []
            : (["limited_driver_context"] as const)),
          ...(transaction ? [] : (["limited_transaction_context"] as const)),
        ],
      },
      usage: { inputTokens: 100, outputTokens: 150 },
    };
  }
}
