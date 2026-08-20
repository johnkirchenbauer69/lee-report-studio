import { q2SampleReport } from "../../../src/data-providers/sample/q2SampleReport.ts";
import type { ReportDataRequest } from "../../report-data-service/contracts.ts";
import type { AscendixReportAdapter } from "./AscendixReportAdapter.ts";

export class MockAscendixReportAdapter implements AscendixReportAdapter {
  async loadReportSource(request: ReportDataRequest) {
    if (request.market !== "Chicago" || request.period !== "2026 Q2") {
      throw new Error(
        `Mock report data has no historical record for ${request.market} / ${request.period}.`,
      );
    }
    const report = structuredClone(q2SampleReport);
    return {
      report,
      recordCounts: {
        marketData: report.submarkets.length + report.historicalPeriods.length,
        leases: report.leasing.length,
        sales: report.sales.length,
        availabilities: report.availabilities.length,
        construction: report.construction.length,
      },
      salesforceOrg: "mock",
    };
  }

  async health() {
    return { configured: true, connected: true, mode: "mock" as const };
  }
}
