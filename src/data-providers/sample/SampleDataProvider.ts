import type { ReportDataProvider } from "../ReportDataProvider";
import type { ReportGenerationRequest } from "../../report-engine/schema/generation";
import { q2SampleReport } from "./q2SampleReport";
import { ReportImportError } from "../ReportDataProvider";

export class SampleDataProvider implements ReportDataProvider {
  readonly id = "sample" as const;
  async loadReportData(request: ReportGenerationRequest) {
    const report = structuredClone(q2SampleReport);
    if (
      request.period !== report.report.period ||
      request.market !== report.report.market
    ) {
      throw new ReportImportError(
        "Sample data does not match this report request.",
        [
          `Requested ${request.market} ${request.period}; the fixture is ${report.report.market} ${report.report.period}.`,
        ],
      );
    }
    report.report.templateId = request.templateId;
    return {
      report,
      provider: this.id,
      sourceMetadata: {
        importedAt: "2026-07-22T00:00:00.000Z",
        sourceName: "Approved Q2 2026 reference fixture",
        sourceVersion: "1.0",
      },
      completeness: report.dataCompleteness,
    };
  }
}
