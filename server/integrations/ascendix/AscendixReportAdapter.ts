import type { IndustrialMarketReport } from "../../../src/report-engine/schema/industrialMarketReport.ts";
import type { ReportDataRequest } from "../../report-data-service/contracts.ts";

export interface AscendixAdapterResult {
  report: IndustrialMarketReport;
  recordCounts: Record<string, number>;
  salesforceOrg?: string;
  diagnostics?: string[];
  sourceDefinition?: {
    period: string;
    geography: string;
    headlineSource: string;
    trendSource: string;
    contributorSource: string;
    apiCallCounts: Record<string, number>;
    propertyDataRollup?: Record<string, number>;
  };
}

export interface AscendixReportAdapter {
  loadReportSource(request: ReportDataRequest): Promise<AscendixAdapterResult>;
  health(): Promise<{
    configured: boolean;
    connected: boolean;
    mode: "mock" | "salesforce";
    instanceUrl?: string;
    authMode?: "client-credentials" | "soap-login";
    apiVersion?: string;
  }>;
}
