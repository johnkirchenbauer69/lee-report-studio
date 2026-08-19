import type {
  DatasetSectionStatus,
  IndustrialMarketReport,
} from "../report-engine/schema/industrialMarketReport";
import type {
  ProviderSourceMetadata,
  ReportGenerationRequest,
  ReportProviderId,
} from "../report-engine/schema/generation";

export interface ReportDataProviderResult {
  report: IndustrialMarketReport;
  provider: ReportProviderId;
  sourceMetadata: ProviderSourceMetadata;
  completeness: DatasetSectionStatus[];
}

export interface ReportDataProvider {
  readonly id: ReportProviderId;
  loadReportData(
    request: ReportGenerationRequest,
  ): Promise<ReportDataProviderResult>;
}

export class ReportImportError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "ReportImportError";
  }
}
