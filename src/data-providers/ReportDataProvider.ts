import type { IndustrialMarketReport } from '../report-engine/schema/industrialMarketReport';
import type { ReportGenerationRequest, ReportProviderId } from '../report-engine/schema/generation';

export interface ReportDataProvider {
  readonly id: ReportProviderId;
  loadReportData(request: ReportGenerationRequest): Promise<IndustrialMarketReport>;
}

export class ReportImportError extends Error {
  constructor(message: string, readonly issues: string[] = []) {
    super(message);
    this.name = 'ReportImportError';
  }
}

