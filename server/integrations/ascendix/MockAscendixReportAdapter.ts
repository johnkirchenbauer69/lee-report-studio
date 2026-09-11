import { q2SampleReport } from "../../../src/data-providers/sample/q2SampleReport.ts";
import type { ReportDataRequest } from "../../report-data-service/contracts.ts";
import type { AscendixReportAdapter } from "./AscendixReportAdapter.ts";

export class MockAscendixReportAdapter implements AscendixReportAdapter {
  async discoverReportPeriods() {
    return [
      { label: "2026 Q3", periodEnd: "2026-09-30", submarketCount: 18 },
      { label: "2026 Q2", periodEnd: "2026-06-30", submarketCount: 18 },
      { label: "2026 Q1", periodEnd: "2026-03-31", submarketCount: 18 },
      { label: "2025 Q4", periodEnd: "2025-12-31", submarketCount: 18 },
    ];
  }

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
