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

export const narrativeQualityFlagSchema = z.enum([
  "limited_driver_context",
  "limited_transaction_context",
  "interpretive_statement",
  "numeric_validation_warning",
  "entity_validation_warning",
]);
export type NarrativeQualityFlag = z.infer<
  typeof narrativeQualityFlagSchema
>;

export const narrativeClaimSchema = z
  .object({
    claim: z.string().min(1).max(1_000),
    supportKeys: z.array(z.string().min(1).max(160)).min(1).max(12),
    evidenceClass: z.enum(["direct", "derived", "interpretive"]),
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
  revisions: NarrativeRevision[];
  regenerationInstruction?: string;
  wordCount: number;
  overflow: boolean;
  error?: string;
  usage?: NarrativeUsage;
}

export type NarrativeContextCategory =
  | "metric"
  | "trend"
  | "ranking"
  | "driver"
  | "lease"
  | "sale"
  | "availability"
  | "construction"
  | "delivery";

export interface NarrativeContextFact {
  contextKey: string;
  category: NarrativeContextCategory;
  label: string;
  value: string | number | null;
  displayValue: string;
  sourceType:
    | "Market_Data__c"
    | "Property_Data__c"
    | "Market_Data_Contributor__c"
    | "Report_Data_Service";
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
  facts: Omit<NarrativeContextFact, "internalSourceIds">[];
}

export const NARRATIVE_PROMPT_PROFILES = {
  overall: {
    version: "overall-market-v1",
    targetMinWords: 150,
    targetMaxWords: 190,
    hardMaxWords: 210,
  },
  submarket: {
    version: "submarket-v1",
    targetMinWords: 105,
    targetMaxWords: 140,
    hardMaxWords: 160,
  },
} as const;

export const countNarrativeWords = (text: string) =>
  text.trim() ? text.trim().split(/\s+/).length : 0;
