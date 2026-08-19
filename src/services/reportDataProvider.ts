import { sampleData } from '../data/sampleData';

export interface ReportRequest {
  period: string;
  market: string;
  submarkets: string[];
}

export interface ReportDataProvider<T = unknown> {
  getIndustrialMarketReport(request: ReportRequest): Promise<T>;
}

export class MockReportDataProvider implements ReportDataProvider<typeof sampleData> {
  async getIndustrialMarketReport(_request: ReportRequest) {
    return structuredClone(sampleData);
  }
}

// Production TODO:
// Implement AscendixReportDataProvider behind a server-side endpoint.
// Do not expose Salesforce credentials or privileged connector operations in the browser.
