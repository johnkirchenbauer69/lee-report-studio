import { CHICAGO_SUBMARKETS } from "../submarkets";
import {
  NARRATIVE_ANALYTICAL_TYPES,
  NARRATIVE_CONTEXT_CATEGORIES,
  NARRATIVE_CONTEXT_MODEL_VERSION,
  NARRATIVE_CONTEXT_SOURCE_TYPES,
  NARRATIVE_EDITORIAL_QA_FLAGS,
  NARRATIVE_EVIDENCE_CLASSES,
  NARRATIVE_EVIDENCE_STRENGTHS,
  NARRATIVE_OUTPUT_CONTRACT_VERSION,
  NARRATIVE_PROMPT_PROFILES,
  NARRATIVE_TRANSPORT_PROMPT_PROFILES,
  NARRATIVE_SUBMITTED_QUALITY_FLAGS,
} from "./schema";
import { OVERALL_MARKET_NARRATIVE_ID } from "./workflow";

const MARKET_IDS = [
  OVERALL_MARKET_NARRATIVE_ID,
  ...CHICAGO_SUBMARKETS.map(({ id }) => id),
];

const SUBMIT_FIELDS = [
  "marketId",
  "narrative",
  "claims",
  "contextKeysUsed",
  "qualityFlags",
  "promptVersion",
];

const LIMITS = {
  narrativeCharacters: 5_000,
  claims: 16,
  claimCharacters: 1_000,
  supportKeysPerClaim: 12,
  contextKeyCharacters: 160,
  contextKeysUsed: 40,
  qualityFlags: 8,
};

/**
 * Canonical, machine-readable boundary contract for external narrative jobs
 * (narrative-v2). The checked-in JSON artifact is generated from this shape
 * and pinned by the LEE Intelligence MCP, so it is frozen: Report Studio
 * still transports every job under narrative-v2. Context v3 additions travel
 * as additive fact/context fields the v2 schema already permits.
 */
export const REPORT_STUDIO_NARRATIVE_CONTRACT = {
  contractVersion: NARRATIVE_OUTPUT_CONTRACT_VERSION,
  qualityFlags: [...NARRATIVE_SUBMITTED_QUALITY_FLAGS],
  evidenceClasses: [...NARRATIVE_EVIDENCE_CLASSES],
  contextCategories: [...NARRATIVE_CONTEXT_CATEGORIES],
  contextSourceTypes: [...NARRATIVE_CONTEXT_SOURCE_TYPES],
  marketIds: MARKET_IDS,
  requiredSubmitFields: SUBMIT_FIELDS,
  requiredClaimFields: ["claim", "supportKeys", "evidenceClass"],
  limits: LIMITS,
  profiles: {
    overall: { ...NARRATIVE_TRANSPORT_PROMPT_PROFILES.overall },
    submarket: { ...NARRATIVE_TRANSPORT_PROMPT_PROFILES.submarket },
  },
  paragraphValidation: "advisory",
} as const;

/**
 * Local source of truth for the coordinated narrative-contract v3 update.
 * NOT sent to the MCP yet. When the MCP adopts it, switch
 * NARRATIVE_OUTPUT_CONTRACT_VERSION to "narrative-v3" in the same release.
 * Checked in as contracts/report-studio-narrative-contract-v3.draft.json.
 */
export const REPORT_STUDIO_NARRATIVE_CONTRACT_V3_DRAFT = {
  contractVersion: "narrative-v3",
  status: "draft",
  contextModelVersion: NARRATIVE_CONTEXT_MODEL_VERSION,
  qualityFlags: [
    ...NARRATIVE_SUBMITTED_QUALITY_FLAGS,
    ...NARRATIVE_EDITORIAL_QA_FLAGS,
  ],
  evidenceClasses: [...NARRATIVE_EVIDENCE_CLASSES],
  contextCategories: [...NARRATIVE_CONTEXT_CATEGORIES],
  analyticalTypes: [...NARRATIVE_ANALYTICAL_TYPES],
  evidenceStrengths: [...NARRATIVE_EVIDENCE_STRENGTHS],
  contextSourceTypes: [...NARRATIVE_CONTEXT_SOURCE_TYPES],
  optionalFactFields: [
    "analyticalType",
    "editorialPriority",
    "evidenceStrength",
    "driverType",
    "causalSupport",
    "priorValue",
    "currentValue",
    "changeValue",
    "materialityPercent",
    "visibleOn",
    "constructionType",
    "explanationProvenance",
  ],
  optionalContextFields: ["editorialBrief"],
  editorialBriefFields: [
    "contextModelVersion",
    "pageContext",
    "causalCoverage",
    "editorialProfile",
    "marketActivity",
    "rules",
  ],
  pageContextFields: [
    "marketIndicatorsVisible",
    "trendChartsVisible",
    "submarketTableVisible",
    "topLeasesVisible",
    "topSalesVisible",
    "propertyCardsVisible",
    "detailedSupplyPageFollows",
  ],
  marketIds: MARKET_IDS,
  requiredSubmitFields: SUBMIT_FIELDS,
  requiredClaimFields: ["claim", "supportKeys", "evidenceClass"],
  limits: LIMITS,
  profiles: {
    overall: { ...NARRATIVE_PROMPT_PROFILES.overall },
    submarket: { ...NARRATIVE_PROMPT_PROFILES.submarket },
  },
  paragraphValidation: "advisory",
} as const;
