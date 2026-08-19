import {
  describeReportSchemaError,
  industrialMarketReportSchema,
} from "../../report-engine/schema/industrialMarketReport";
import type { ReportGenerationRequest } from "../../report-engine/schema/generation";
import { inferCompleteness } from "../completeness";
import type { ReportDataProvider } from "../ReportDataProvider";
import { ReportImportError } from "../ReportDataProvider";
import { addImportedMetricProvenance } from "../providerIntegrity";

export class AscendixDataProvider implements ReportDataProvider {
  readonly id = "ascendix" as const;

  constructor(private readonly endpoint = "/api/report-data/ascendix") {}

  async loadReportData(request: ReportGenerationRequest) {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new ReportImportError("Ascendix import is unavailable.", [
        "Configure the authenticated server-side Ascendix/Salesforce adapter. No credentials are accepted in the browser.",
      ]);
    }
    const payload: unknown = await response.json();
    const partialSchema = industrialMarketReportSchema.partial({
      dataCompleteness: true,
    });
    const parsed = partialSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ReportImportError(
        "Ascendix returned an invalid report payload.",
        describeReportSchemaError(parsed.error, payload),
      );
    }

    const importedAt = new Date().toISOString();
    const sourceId = "ascendix-report-service";
    const report = {
      ...parsed.data,
      dataCompleteness:
        parsed.data.dataCompleteness ??
        inferCompleteness(parsed.data, sourceId),
    };
    const validated = industrialMarketReportSchema.parse(report);
    const traced = addImportedMetricProvenance(validated, {
      sourceId,
      sourceType: "ascendix",
      importedAt,
      reference: (index, field) =>
        `Ascendix normalized response $.submarkets[${index}].${field}`,
    });
    return {
      report: traced,
      provider: this.id,
      sourceMetadata: { importedAt, sourceName: sourceId },
      completeness: traced.dataCompleteness,
    };
  }
}
