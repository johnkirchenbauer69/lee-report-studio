import { getReportDataProvider } from "../../data-providers/providerRegistry";
import type { ReportDataProviderResult } from "../../data-providers/ReportDataProvider";
import type { ReportTemplate } from "../../types/report";
import { buildPresentationModel } from "../bindings/presentationModel";
import { calculateOverallMarket } from "../calculations/marketCalculations";
import { industrialMarketReportSchema } from "../schema/industrialMarketReport";
import type {
  ReportGenerationRequest,
  ReportInstance,
} from "../schema/generation";
import {
  evaluateReportReadiness,
  validateRequestConsistency,
} from "../validation/reportValidation";
import { expandTemplatePages } from "./repeaters";
import { prepareTemplateForReport } from "./prepareTemplate";

export interface GenerationProgress {
  stage:
    | "loading"
    | "normalizing"
    | "calculating"
    | "reconciling"
    | "validating"
    | "building-presentation"
    | "expanding"
    | "creating"
    | "complete";
  message: string;
}

const progress = (
  callback: ((progress: GenerationProgress) => void) | undefined,
  stage: GenerationProgress["stage"],
  message: string,
) => callback?.({ stage, message });

export async function loadSourceData(request: ReportGenerationRequest) {
  return getReportDataProvider(request.source.provider).loadReportData(request);
}

export function normalizeReportData(result: ReportDataProviderResult) {
  return industrialMarketReportSchema.parse(result.report);
}

export function calculateDerivedMetrics(
  report: ReturnType<typeof normalizeReportData>,
  request: ReportGenerationRequest,
  provider?: ReportDataProviderResult["provider"],
) {
  if (provider === "ascendix") return report;
  return calculateOverallMarket(report, request);
}

export function reconcileSources(
  report: ReturnType<typeof normalizeReportData>,
) {
  const overrides = new Map(
    report.presentationOverrides.map((override) => [
      override.fieldPath,
      override,
    ]),
  );
  return {
    ...report,
    provenance: report.provenance.map((record) => {
      const override = overrides.get(record.fieldPath);
      if (record.status !== "conflict" || !override) return record;
      return {
        ...record,
        status: "override" as const,
        authority: override.authority,
        note: override.reason,
      };
    }),
  };
}

export async function generateReportInstance(
  template: ReportTemplate,
  request: ReportGenerationRequest,
  onProgress?: (progress: GenerationProgress) => void,
): Promise<ReportInstance> {
  progress(
    onProgress,
    "loading",
    request.source.provider === "ascendix"
      ? "Connecting to Salesforce, loading market data, and creating a source snapshot"
      : `Loading ${request.source.provider} source data`,
  );
  const providerResult = await loadSourceData(request);

  progress(
    onProgress,
    "normalizing",
    request.source.provider === "ascendix"
      ? "Validating the shared Report Data Service snapshot"
      : "Validating normalized source records",
  );
  const normalized = normalizeReportData(providerResult);
  const consistencyIssues = validateRequestConsistency(normalized, request);
  if (consistencyIssues.length) {
    throw new Error(
      `Source consistency validation failed:\n${consistencyIssues.map((issue) => `- ${issue.message}`).join("\n")}`,
    );
  }

  progress(
    onProgress,
    "calculating",
    "Calculating metrics from the declared analytical universe",
  );
  const calculated = calculateDerivedMetrics(
    normalized,
    request,
    providerResult.provider,
  );

  progress(
    onProgress,
    "reconciling",
    "Applying explicit, auditable source reconciliations",
  );
  const reconciled = reconcileSources(calculated);

  progress(onProgress, "validating", "Evaluating report readiness");
  const readiness = evaluateReportReadiness(
    reconciled,
    template,
    providerResult.provider,
  );
  const structuralErrors = readiness.issues.filter(
    (issue) => issue.level === "error",
  );
  if (structuralErrors.length) {
    throw new Error(
      `Report validation failed:\n${structuralErrors.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
    );
  }

  progress(
    onProgress,
    "building-presentation",
    "Building formatted presentation values",
  );
  const presentationData = buildPresentationModel(reconciled);
  const preparedTemplate = prepareTemplateForReport(
    template,
    reconciled,
    presentationData,
    providerResult.provider,
  );

  progress(
    onProgress,
    "expanding",
    "Expanding selected detail pages and repeating components",
  );
  const pages = expandTemplatePages(
    preparedTemplate,
    presentationData,
    request.pageSelection,
  );

  progress(onProgress, "creating", "Creating versioned report instance");
  const instance: ReportInstance = {
    id: `report-${crypto.randomUUID()}`,
    templateId: template.id,
    templateVersion: template.version,
    generationRequest: structuredClone(request),
    provider: providerResult.provider,
    sourceMetadata: structuredClone(providerResult.sourceMetadata),
    sourceSnapshotId: providerResult.snapshot?.id,
    sourceSnapshotHash: providerResult.snapshot?.hash,
    reportDefinitionVersion: providerResult.snapshot?.reportDefinitionVersion,
    generatedAt: new Date().toISOString(),
    dataSnapshot: structuredClone(reconciled),
    pages,
    fontReferences: (template.assets ?? [])
      .filter(
        (asset) =>
          asset.type === "font" &&
          asset.fontFamily &&
          asset.fontWeight != null &&
          asset.fontStyle &&
          asset.checksum,
      )
      .map((asset) => ({
        assetId: asset.id,
        family: asset.fontFamily!,
        weight: asset.fontWeight!,
        style: asset.fontStyle!,
        checksum: asset.checksum!,
      })),
    manualOverrides: [],
    readiness,
    status: "draft",
  };
  progress(
    onProgress,
    "complete",
    readiness.canPublish
      ? "Report ready to edit and publish"
      : `Draft ready with ${readiness.blockers.length} publication blocker${readiness.blockers.length === 1 ? "" : "s"}`,
  );
  return instance;
}
