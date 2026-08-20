import { z } from "zod";
import { sampleTemplate } from "../../../src/data/sampleTemplate.ts";
import { evaluateReportReadiness } from "../../../src/report-engine/validation/reportValidation.ts";
import type { ReportDataService } from "../../report-data-service/ReportDataService.ts";
import { reportDataRequestSchema } from "../../report-data-service/contracts.ts";

export const snapshotIdSchema = z.object({ snapshotId: z.string().min(1) });
export const provenanceInputSchema = snapshotIdSchema.extend({
  fieldPath: z.string().min(1),
});

export class ReportMcpTools {
  private readonly service: ReportDataService;

  constructor(service: ReportDataService) {
    this.service = service;
  }

  async getMarketReportData(input: unknown) {
    const result = await this.service.getIndustrialMarketReport(
      reportDataRequestSchema.parse(input),
    );
    return {
      summary: {
        market: result.report.report.market,
        period: result.report.report.period,
        submarketCount: result.report.submarkets.length,
      },
      snapshot: result.snapshot,
      sourceMetadata: result.sourceMetadata,
      completeness: result.completeness,
      conflicts: result.report.provenance.filter(
        (item) => item.status === "conflict",
      ),
      report: result.report,
    };
  }

  async validateReport(input: unknown) {
    const { snapshotId } = snapshotIdSchema.parse(input);
    const snapshot = await this.requireSnapshot(snapshotId);
    const readiness = evaluateReportReadiness(
      snapshot.report,
      sampleTemplate,
      "ascendix",
    );
    return {
      snapshotId,
      readiness,
      missingSections: snapshot.report.dataCompleteness.filter(
        (item) => item.status === "missing" || item.status === "partial",
      ),
      unresolvedConflicts: snapshot.report.provenance.filter(
        (item) => item.status === "conflict",
      ),
    };
  }

  async getReportConflicts(input: unknown) {
    const { snapshotId } = snapshotIdSchema.parse(input);
    const snapshot = await this.requireSnapshot(snapshotId);
    return {
      snapshotId,
      conflicts: snapshot.report.provenance.filter((item) =>
        ["conflict", "reconciled", "override"].includes(item.status),
      ),
    };
  }

  async getReportProvenance(input: unknown) {
    const { snapshotId, fieldPath } = provenanceInputSchema.parse(input);
    const snapshot = await this.requireSnapshot(snapshotId);
    return {
      snapshotId,
      fieldPath,
      records: snapshot.report.provenance.filter(
        (item) => item.fieldPath === fieldPath,
      ),
      overrides: snapshot.report.presentationOverrides.filter(
        (item) => item.fieldPath === fieldPath,
      ),
    };
  }

  async getReportServiceStatus() {
    return {
      ...(await this.service.getStatus()),
      reportDefinitionVersion: "industrial-market-report-data-v1",
      availableReportTypes: ["industrial-market-report"],
      capabilities: [
        "get_market_report_data",
        "validate_report",
        "get_report_conflicts",
        "get_report_provenance",
        "get_report_service_status",
      ],
    };
  }

  private async requireSnapshot(id: string) {
    const snapshot = await this.service.getSnapshot(id);
    if (!snapshot) throw new Error(`Report snapshot ${id} was not found.`);
    return snapshot;
  }
}
