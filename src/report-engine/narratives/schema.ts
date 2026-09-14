import { z } from "zod";

export const NARRATIVE_STATUSES = [
  "not_generated",
  "generating",
  "draft",
  "edited",
  "approved",
  "stale",
  "failed",
] as const;

export const narrativeStatusSchema = z.enum(NARRATIVE_STATUSES);
export type NarrativeStatus = z.infer<typeof narrativeStatusSchema>;

export const NARRATIVE_QUALITY_FLAGS = [
  "limited_driver_context",
  "limited_transaction_context",
  "interpretive_statement",
  "numeric_validation_warning",
  "entity_validation_warning",
  /** Narrative opens with a banned boilerplate pattern ("[Market] ended…"). */
  "template_opening",
  /** Several narratives in the same generation batch share the same opening. */
  "batch_repeated_opening",
  /** Prose reads as a sentence-by-sentence metric recitation with little interpretation. */
  "metric_dump",
  /** Too many consecutive sentences share the same metric-name lead-in. */
  "repetitive_sentence_structure",
  /** Overused boilerplate connective phrasing. */
  "boilerplate_phrasing",
  /** Sufficient trend history existed but the narrative made no comparative statement. */
  "missing_comparative_context",
] as const;
export const narrativeQualityFlagSchema = z.enum(NARRATIVE_QUALITY_FLAGS);
export type NarrativeQualityFlag = z.infer<
  typeof narrativeQualityFlagSchema
>;

/**
 * Detailed, human-reviewable metadata for a single non-blocking grounding
 * warning (see NARRATIVE_QUALITY_FLAGS' entity/numeric warning flags).
 *
 * The flag stays the reviewer-facing signal already carried on
 * qualityFlags; this is the small companion structure the review UI needs
 * to show WHICH phrase triggered it and WHY, without inventing a parallel
 * warning system.
 */
export const narrativeValidationWarningSchema = z
  .object({
    flag: narrativeQualityFlagSchema,
    /** The exact narrative phrase, entity, or number that could not be matched. */
    phrase: z.string().min(1).max(300),
    /** Reviewer-facing explanation, safe to render directly (no internal IDs). */
    message: z.string().min(1).max(500),
  })
  .strict();
export type NarrativeValidationWarning = z.infer<
  typeof narrativeValidationWarningSchema
>;

export const NARRATIVE_EVIDENCE_CLASSES = ["direct", "derived", "interpretive"] as const;

export const narrativeClaimSchema = z
  .object({
    claim: z.string().min(1).max(1_000),
    supportKeys: z.array(z.string().min(1).max(160)).min(1).max(12),
    evidenceClass: z.enum(NARRATIVE_EVIDENCE_CLASSES),
  })
  .strict();
export type NarrativeClaim = z.infer<typeof narrativeClaimSchema>;

export const narrativeGenerationResultSchema = z
  .object({
    narrative: z.string().min(1).max(5_000),
    claims: z.array(narrativeClaimSchema).max(16),
    contextKeysUsed: z.array(z.string().min(1).max(160)).max(40),
    qualityFlags: z.array(narrativeQualityFlagSchema).max(8),
  })
  .strict();
export type NarrativeGenerationResult = z.infer<
  typeof narrativeGenerationResultSchema
>;

export interface NarrativeUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface NarrativeRevision {
  id: string;
  text: string;
  source: "ai" | "manual";
  status: NarrativeStatus;
  timestamp: string;
  model?: string;
  promptVersion?: string;
  contextHash?: string;
  regenerationInstruction?: string;
  claims: NarrativeClaim[];
  qualityFlags: NarrativeQualityFlag[];
  /** Populated when qualityFlags includes a detailed grounding warning. */
  validationWarnings?: NarrativeValidationWarning[];
}

export interface NarrativeRecord {
  marketId: string;
  marketName: string;
  marketKind: "overall" | "submarket";
  period: string;
  text: string;
  status: NarrativeStatus;
  source: "ai" | "manual";
  promptVersion: string;
  model?: string;
  contextHash?: string;
  reportDataHash: string;
  generatedAt?: string;
  editedAt?: string;
  approvedAt?: string;
  claims: NarrativeClaim[];
  contextKeysUsed: string[];
  qualityFlags: NarrativeQualityFlag[];
  /**
   * Detailed, reviewer-facing metadata for entity/numeric grounding
   * warnings and other non-blocking review flags. Never contains
   * Salesforce IDs or other internal identifiers.
   */
  validationWarnings?: NarrativeValidationWarning[];
  revisions: NarrativeRevision[];
  regenerationInstruction?: string;
  wordCount: number;
  overflow: boolean;
  error?: string;
  usage?: NarrativeUsage;
}

export const NARRATIVE_CONTEXT_CATEGORIES = [
  "metric",
  "trend",
  "ranking",
  "driver",
  "lease",
  "sale",
  "availability",
  "construction",
  "delivery",
  /** Deterministic counts of governed quarter records (leases, sales, deliveries, …). */
  "count",
  /** Speculative/BTS construction and delivery composition. */
  "composition",
  /** Highs/lows, streaks, and multi-quarter averages derived from governed history. */
  "historical",
  /** Leasing size-band / concentration facts. */
  "concentration",
  /**
   * Curated, deterministic explanation context that goes beyond a raw metric
   * (e.g. "vacancy increase driven by named negative-absorption move-outs").
   * Still governed data — never a model inference.
   */
  "market_driver",
] as const;
export type NarrativeContextCategory =
  (typeof NARRATIVE_CONTEXT_CATEGORIES)[number];

export const NARRATIVE_CONTEXT_SOURCE_TYPES = [
  "Market_Data__c",
  "Property_Data__c",
  "Market_Data_Contributor__c",
  "Report_Data_Service",
] as const;

export interface NarrativeContextFact {
  contextKey: string;
  category: NarrativeContextCategory;
  label: string;
  value: string | number | null;
  displayValue: string;
  sourceType: (typeof NARRATIVE_CONTEXT_SOURCE_TYPES)[number];
  authority: string;
  calculation?: string;
  publicationSafe: true;
  /** Server-only provenance. API serializers must remove this field. */
  internalSourceIds?: string[];
  entityNames?: string[];
}

export interface NarrativeContext {
  marketId: string;
  marketName: string;
  marketKind: "overall" | "submarket";
  period: string;
  promptVersion: string;
  facts: NarrativeContextFact[];
  contextHash: string;
}

export interface PublicNarrativeContext
  extends Omit<NarrativeContext, "facts"> {
  outputContractVersion: typeof NARRATIVE_OUTPUT_CONTRACT_VERSION;
  promptProfile: NarrativePromptProfile;
  facts: Omit<NarrativeContextFact, "internalSourceIds">[];
}

export const NARRATIVE_OUTPUT_CONTRACT_VERSION = "narrative-v2" as const;

export const NARRATIVE_PROMPT_PROFILES = {
  overall: {
    version: "overall-market-v2",
    targetMinWords: 225,
    targetMaxWords: 325,
    hardMaxWords: 375,
    targetParagraphsMin: 3,
    targetParagraphsMax: 5,
  },
  submarket: {
    version: "submarket-v2",
    targetMinWords: 160,
    targetMaxWords: 230,
    hardMaxWords: 275,
    targetParagraphsMin: 2,
    targetParagraphsMax: 4,
  },
} as const;

export type NarrativePromptProfile =
  (typeof NARRATIVE_PROMPT_PROFILES)[keyof typeof NARRATIVE_PROMPT_PROFILES];

export const countNarrativeWords = (text: string) =>
  text.trim() ? text.trim().split(/\s+/).length : 0;
