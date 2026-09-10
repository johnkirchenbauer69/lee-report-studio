import type {
  EditorSettings,
  FontReference,
  ReportPage,
} from "../../types/report";
import type { ReportValidationIssue } from "../validation/reportValidation";
import type { IndustrialMarketReport } from "./industrialMarketReport";
import type { NarrativeRecord } from "../narratives/schema";

export const REPORT_INSTANCE_SCHEMA_VERSION = 1 as const;

export type ReportProviderId = "sample" | "json" | "excel" | "ascendix";

export interface ReportGenerationRequest {
  templateId: string;
  templateVersion: string;
  templateChecksum?: string;
  market: string;
  period: string;
  calculationScope:
    | { type: "all-submarkets" }
    | { type: "selected-submarkets"; submarkets: string[] };
  pageSelection: { submarketIds?: string[]; submarkets?: string[] };
  source: { provider: ReportProviderId; configuration?: unknown };
}

export interface ManualOverride {
  elementId: string;
  bindingPath?: string;
  generatedValue: unknown;
  overrideValue: unknown;
  createdAt: string;
}

export interface ProviderSourceMetadata {
  importedAt: string;
  sourceName?: string;
  sourceVersion?: string;
  /** Sanitized source/asset diagnostics frozen with the generated edition. */
  diagnostics?: string[];
}

/**
 * Immutable template metadata needed to reopen generated pages without
 * loading the mutable/deletable source template record.
 */
export interface ReportTemplateSnapshot {
  name: string;
  settings?: EditorSettings;
}

export interface ReportReadiness {
  canEdit: boolean;
  canExportDraft: boolean;
  canApprove: boolean;
  canPublish: boolean;
  blockers: ReportValidationIssue[];
  issues: ReportValidationIssue[];
}

export type ExternalNarrativeJobStatus =
  | "creating"
  | "waiting_for_chatgpt"
  | "importing"
  | "complete"
  | "failed"
  | "expired";

export interface ExternalNarrativeJob {
  provider: "chatgpt_mcp";
  jobId: string;
  /** Local generation-attempt key used to make remote creation idempotent. */
  idempotencyKey?: string;
  status: ExternalNarrativeJobStatus;
  createdAt: string;
  updatedAt: string;
  /** Markets this job asked ChatGPT to generate. */
  marketIds: string[];
  generationScope: "all" | "selected";
  /** Configured ChatGPT custom-app URL, when one is set. */
  appUrl?: string;
  handoffPrompt?: string;
  expiresAt?: string;
  importedAt?: string;
  importFingerprint?: string;
  error?: string;
  errorCode?: string;
  /** Optional editorial steer sent with the job. */
  instruction?: string;
  /**
   * contextHash per market as it was when the job was created. Import
   * compares these against freshly rebuilt local contexts to detect report
   * data that moved while the narratives were being written.
   */
  contextHashes?: Record<string, string>;
}

export interface ReportInstance {
  /** Persisted storage schema; independent of the report template version. */
  schemaVersion: typeof REPORT_INSTANCE_SCHEMA_VERSION;
  /** Monotonic server-assigned concurrency revision. */
  revision: number;
  id: string;
  templateId: string;
  templateVersion: string;
  templateChecksum: string;
  /** Provenance-adjacent editor metadata; generated pages remain authoritative. */
  sourceTemplateSnapshot?: ReportTemplateSnapshot;
  generationRequest: ReportGenerationRequest;
  provider: ReportProviderId;
  sourceMetadata: ProviderSourceMetadata;
  sourceSnapshotId?: string;
  sourceSnapshotHash?: string;
  reportDefinitionVersion?: string;
  generatedAt: string;
  dataSnapshot: IndustrialMarketReport;
  pages: ReportPage[];
  fontReferences: FontReference[];
  manualOverrides: ManualOverride[];
  /** Quarter-specific editorial content. Master templates remain layout-only. */
  narratives: NarrativeRecord[];
  /**
   * Runtime handoff state for narrative generation performed outside Report
   * Studio. Belongs to the instance, never to the master template.
   */
  externalNarrativeJob?: ExternalNarrativeJob;
  readiness: ReportReadiness;
  status: "draft" | "approved" | "published";
}
