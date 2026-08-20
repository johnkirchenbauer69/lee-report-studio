import type { IndustrialMarketReport } from "../../../src/report-engine/schema/industrialMarketReport.ts";
import type { ReportDataRequest } from "../../report-data-service/contracts.ts";

export interface AscendixAdapterResult {
  report: IndustrialMarketReport;
  recordCounts: Record<string, number>;
  salesforceOrg?: string;
}

export interface AscendixReportAdapter {
  loadReportSource(request: ReportDataRequest): Promise<AscendixAdapterResult>;
  health(): Promise<{
    configured: boolean;
    connected: boolean;
    mode: "mock" | "salesforce";
  }>;
}
