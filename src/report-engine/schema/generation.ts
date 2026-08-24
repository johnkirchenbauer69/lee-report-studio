import type { FontReference, ReportPage } from "../../types/report";
import type { ReportValidationIssue } from "../validation/reportValidation";
import type { IndustrialMarketReport } from "./industrialMarketReport";

export type ReportProviderId = "sample" | "json" | "excel" | "ascendix";

export interface ReportGenerationRequest {
  templateId: string;
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
}

export interface ReportReadiness {
  canEdit: boolean;
  canExportDraft: boolean;
  canApprove: boolean;
  canPublish: boolean;
  blockers: ReportValidationIssue[];
  issues: ReportValidationIssue[];
}

export interface ReportInstance {
  id: string;
  templateId: string;
  templateVersion: string;
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
  readiness: ReportReadiness;
  status: "draft" | "approved" | "published";
}
