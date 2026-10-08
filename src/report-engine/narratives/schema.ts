import { z } from "zod";
import type { NarrativeBrokerContext } from "./brokerInterviews";

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

/**
 * Quality flags the narrative-v2 transport contract allows an external
 * generator (ChatGPT via the LEE Intelligence MCP, or the direct model's
 * structured output) to submit. Frozen: the live MCP pins this exact enum,
 * so adding a value here would make every submitted batch fail remote
 * validation. Report Studio-only QA flags belong in
 * NARRATIVE_EDITORIAL_QA_FLAGS below.
 */
export const NARRATIVE_SUBMITTED_QUALITY_FLAGS = [
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

/**
 * Editorial QA flags detected locally by Report Studio's validator (context
 * v3). They are advisory review signals, never submission gates, and are
 * never sent to the MCP. They join the transport enum only with a
 * coordinated narrative-contract v3 update (see
 * contracts/report-studio-narrative-contract-v3.draft.json).
 */
export const NARRATIVE_EDITORIAL_QA_FLAGS = [
  /** Three or more individual transactions recited, or a transaction-list cadence. */
  "transaction_repetition",
  /** The opening does not state a market thesis (metric-led or number-heavy lead). */
  "weak_thesis",
  /** Forward-looking claims without governed pipeline/commencement support. */
  "unsupported_outlook",
  /** Too many figures per sentence/word for interpretive prose. */
  "excessive_metric_density",
  /** Mechanically repeats headline values already visible on the report page. */
  "page_redundancy",
  /** Ends on a formulaic summary/positioning sentence. */
  "generic_closing",
  /** Causal wording ("driven by", "because") with no governed driver in context. */
  "unsupported_causal_claim",
] as const;

export const NARRATIVE_QUALITY_FLAGS = [
  ...NARRATIVE_SUBMITTED_QUALITY_FLAGS,
  ...NARRATIVE_EDITORIAL_QA_FLAGS,
] as const;
export const narrativeQualityFlagSchema = z.enum(NARRATIVE_QUALITY_FLAGS);
export type NarrativeQualityFlag = z.infer<
  typeof narrativeQualityFlagSchema
>;
export const narrativeSubmittedQualityFlagSchema = z.enum(
  NARRATIVE_SUBMITTED_QUALITY_FLAGS,
);

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
    // Generator output is held to the frozen narrative-v2 transport enum.
    qualityFlags: z.array(narrativeSubmittedQualityFlagSchema).max(8),
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
  /**
   * Fingerprint of the exact report data the narrative was written or
   * reviewed against: the data snapshot (excluding narrative prose) plus
   * every data-bearing manual override. Absent on records created before
   * snapshot binding existed; those keep contextHash-only staleness.
   */
  reportDataFingerprint?: string;
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

/**
 * Transport-level fact categories. Frozen at the narrative-v2 enum because
 * the live MCP validates `category` against exactly this list. Context v3
 * analytical distinctions ride on `analyticalType` instead.
 */
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
   * Governed explanatory context (vacancy/availability/absorption bridges,
   * leasing conversion, pipeline change, materiality). Never a model
   * inference and never a Report Studio guess at causality.
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

/**
 * Narrative Context v3 analytical fact types. These ride on each fact as
 * typed metadata (`analyticalType`) rather than replacing `category`,
 * because the live narrative-v2 MCP contract pins the category enum. The
 * explanatory types (bridges, conversion, pipeline change, materiality,
 * driver) are what the editorial prompt prioritizes.
 */
export const NARRATIVE_ANALYTICAL_TYPES = [
  "metric",
  "trend",
  "historical",
  "inflection",
  "ranking",
  "lease",
  "sale",
  "availability",
  "construction",
  "delivery",
  "count",
  "composition",
  "concentration",
  "vacancy_bridge",
  "availability_bridge",
  "absorption_bridge",
  "leasing_conversion",
  "pipeline_change",
  "materiality",
  "market_breadth",
  "market_driver",
] as const;
export type NarrativeAnalyticalType = (typeof NARRATIVE_ANALYTICAL_TYPES)[number];

/** Analytical types that explain a movement rather than describe it. */
export const NARRATIVE_EXPLANATORY_TYPES: ReadonlySet<NarrativeAnalyticalType> =
  new Set<NarrativeAnalyticalType>([
    "vacancy_bridge",
    "availability_bridge",
    "absorption_bridge",
    "leasing_conversion",
    "pipeline_change",
    "materiality",
    "market_driver",
  ]);

/**
 * Evidence strength uses the Market Data Engine's market-explanation-v1
 * vocabulary verbatim ("unspecified" marks facts with no governed strength).
 * Wording policy: confirmed and strong license causal wording (strong
 * without overstating certainty); indicative never does.
 */
export const NARRATIVE_EVIDENCE_STRENGTHS = [
  "confirmed",
  "strong",
  "indicative",
  "unspecified",
] as const;
export type NarrativeEvidenceStrength =
  (typeof NARRATIVE_EVIDENCE_STRENGTHS)[number];

/** Editorial weight the context builder assigns; the prompt leads with "lead". */
export type NarrativeEditorialPriority = "lead" | "supporting" | "background";

/** Report-page components a fact is already visible in (page-aware editing). */
export type NarrativePageComponent =
  | "market_indicators"
  | "trend_charts"
  | "submarket_table"
  | "top_leases"
  | "top_sales"
  | "property_cards";

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
  // --- Narrative Context v3 typed metadata (all optional) ---------------
  analyticalType?: NarrativeAnalyticalType;
  editorialPriority?: NarrativeEditorialPriority;
  /** Governed evidence strength for explanatory facts. */
  evidenceStrength?: NarrativeEvidenceStrength;
  /** Governed driver taxonomy value (e.g. "move_out", "lease_commencement"). */
  driverType?: string;
  /** True only when governed evidence licenses causal wording for this fact. */
  causalSupport?: boolean;
  priorValue?: number | null;
  currentValue?: number | null;
  changeValue?: number | null;
  /** Share (0–100) of the relevant quarterly total this fact represents. */
  materialityPercent?: number | null;
  /** Page components where this value is already visible to the reader. */
  visibleOn?: NarrativePageComponent[];
  /** Governed construction type, verbatim (e.g. Partial-Spec, Expansion). */
  constructionType?: string;
  /** Upstream explanation provenance, preserved as published. */
  explanationProvenance?: {
    version?: string;
    priorSnapshotProvenance?: string;
    priorSnapshotHash?: string;
    comparisonWarnings?: string[];
    /** False when the structured evidence could not be read. */
    trusted?: boolean;
  };
}

/**
 * Editorial metadata about what the reader already sees on the report page.
 * Not a market fact: it steers the prose away from repeating page tables.
 */
export interface NarrativePageContext {
  marketIndicatorsVisible: boolean;
  trendChartsVisible: boolean;
  submarketTableVisible: boolean;
  topLeasesVisible: boolean;
  topSalesVisible: boolean;
  propertyCardsVisible: boolean;
  detailedSupplyPageFollows: boolean;
}

/** Which movements have a governed explanation in this context. */
export interface NarrativeCausalCoverage {
  vacancy: "governed_driver" | "movement_only";
  availability: "governed_driver" | "movement_only";
  absorption: "governed_driver" | "contributors_only" | "movement_only";
  leasingConversion: "governed_driver" | "none";
  pipeline: "governed_driver" | "movement_only";
}

export interface NarrativeEditorialBrief {
  /** Context model version for the analytical metadata above. */
  contextModelVersion: typeof NARRATIVE_CONTEXT_MODEL_VERSION;
  pageContext: NarrativePageContext;
  causalCoverage: NarrativeCausalCoverage;
  /**
   * Report Studio v3 editorial length/paragraph profile. Supersedes the
   * transport promptProfile targets; the hard word maximum is identical.
   */
  editorialProfile: NarrativePromptProfile;
  /** Activity level used to steer length/paragraph choice (never a gate). */
  marketActivity: "quiet" | "moderate" | "active";
  /** Short publication rules, carried in context so the MCP path receives them. */
  rules: string[];
}

export interface NarrativeContext {
  marketId: string;
  marketName: string;
  marketKind: "overall" | "submarket";
  period: string;
  promptVersion: string;
  facts: NarrativeContextFact[];
  /** v3 editorial metadata. Hashed with the facts so page changes re-stale. */
  editorialBrief?: NarrativeEditorialBrief;
  /**
   * Optional supplemental broker interview intelligence
   * (BROKER_INTERVIEW_CONTEXT). Deliberately NOT facts: it is the lowest
   * authority, carries its own publication rules, contains only publishable
   * observations, and is present only when the market has broker coverage.
   * Hashed with the context, so uploading, replacing, or removing an
   * interview re-stales affected narratives.
   */
  brokerContext?: NarrativeBrokerContext;
  contextHash: string;
}

export interface PublicNarrativeContext
  extends Omit<NarrativeContext, "facts"> {
  outputContractVersion: typeof NARRATIVE_OUTPUT_CONTRACT_VERSION;
  /** Transport (narrative-v2) profile; the v3 profile is in editorialBrief. */
  promptProfile: NarrativeTransportPromptProfile;
  facts: Omit<NarrativeContextFact, "internalSourceIds">[];
}

/**
 * Transport contract version sent to the LEE Intelligence MCP. Stays
 * narrative-v2 until a coordinated MCP v3 release: the context v3 additions
 * are additive fields the v2 schema already permits.
 */
export const NARRATIVE_OUTPUT_CONTRACT_VERSION = "narrative-v2" as const;
/** Report Studio's own context model version (typed analytical metadata). */
export const NARRATIVE_CONTEXT_MODEL_VERSION = "narrative-context-v3" as const;

/**
 * Prompt profiles. Paragraph counts are preferred guidance only; the word
 * hard maximum remains the only length gate. The promptProfile object sent
 * to the MCP must contain exactly these six keys (the v2 schema forbids
 * additional properties).
 */
export const NARRATIVE_PROMPT_PROFILES = {
  overall: {
    version: "overall-market-v3",
    targetMinWords: 250,
    targetMaxWords: 340,
    hardMaxWords: 375,
    targetParagraphsMin: 3,
    targetParagraphsMax: 4,
  },
  submarket: {
    version: "submarket-v3",
    targetMinWords: 175,
    targetMaxWords: 240,
    hardMaxWords: 275,
    targetParagraphsMin: 2,
    targetParagraphsMax: 3,
  },
} as const;

/**
 * Frozen narrative-v2 profiles: what goes on the wire. The live MCP compares
 * each context's promptProfile/promptVersion against exactly these values
 * (PROMPT_PROFILE_MISMATCH otherwise), so public contexts carry them while
 * the v3 editorial profile above travels in editorialBrief.editorialProfile.
 * Retire with the coordinated narrative-v3 contract update.
 */
export const NARRATIVE_TRANSPORT_PROMPT_PROFILES = {
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
export type NarrativeTransportPromptProfile =
  (typeof NARRATIVE_TRANSPORT_PROMPT_PROFILES)[keyof typeof NARRATIVE_TRANSPORT_PROMPT_PROFILES];

/** Prompt version a generator must echo back over the narrative-v2 transport. */
export const transportPromptVersion = (marketKind: "overall" | "submarket") =>
  NARRATIVE_TRANSPORT_PROMPT_PROFILES[marketKind].version;

export const countNarrativeWords = (text: string) =>
  text.trim() ? text.trim().split(/\s+/).length : 0;
