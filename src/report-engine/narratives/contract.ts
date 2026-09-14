import { CHICAGO_SUBMARKETS } from "../submarkets";
import {
  NARRATIVE_CONTEXT_CATEGORIES,
  NARRATIVE_CONTEXT_SOURCE_TYPES,
  NARRATIVE_EVIDENCE_CLASSES,
  NARRATIVE_OUTPUT_CONTRACT_VERSION,
  NARRATIVE_PROMPT_PROFILES,
  NARRATIVE_QUALITY_FLAGS,
} from "./schema";
import { OVERALL_MARKET_NARRATIVE_ID } from "./workflow";

/**
 * Canonical, machine-readable boundary contract for external narrative jobs.
 * The checked-in JSON artifact is generated from this shape and pinned by the
 * MCP. A semantic change requires a new output contract version.
 */
export const REPORT_STUDIO_NARRATIVE_CONTRACT = {
  contractVersion: NARRATIVE_OUTPUT_CONTRACT_VERSION,
  qualityFlags: [...NARRATIVE_QUALITY_FLAGS],
  evidenceClasses: [...NARRATIVE_EVIDENCE_CLASSES],
  contextCategories: [...NARRATIVE_CONTEXT_CATEGORIES],
  contextSourceTypes: [...NARRATIVE_CONTEXT_SOURCE_TYPES],
  marketIds: [
    OVERALL_MARKET_NARRATIVE_ID,
    ...CHICAGO_SUBMARKETS.map(({ id }) => id),
  ],
  requiredSubmitFields: [
    "marketId",
    "narrative",
    "claims",
    "contextKeysUsed",
    "qualityFlags",
    "promptVersion",
  ],
  requiredClaimFields: ["claim", "supportKeys", "evidenceClass"],
  limits: {
    narrativeCharacters: 5_000,
    claims: 16,
    claimCharacters: 1_000,
    supportKeysPerClaim: 12,
    contextKeyCharacters: 160,
    contextKeysUsed: 40,
    qualityFlags: 8,
  },
  profiles: {
    overall: { ...NARRATIVE_PROMPT_PROFILES.overall },
    submarket: { ...NARRATIVE_PROMPT_PROFILES.submarket },
  },
  paragraphValidation: "advisory",
} as const;
