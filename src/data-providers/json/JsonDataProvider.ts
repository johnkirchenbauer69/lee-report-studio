import {
  describeReportSchemaError,
  industrialMarketReportSchema,
} from "../../report-engine/schema/industrialMarketReport";
import type { ReportGenerationRequest } from "../../report-engine/schema/generation";
import { inferCompleteness } from "../completeness";
import type { ReportDataProvider } from "../ReportDataProvider";
import { ReportImportError } from "../ReportDataProvider";
import { addImportedMetricProvenance } from "../providerIntegrity";

type JsonConfiguration = { payload: string | unknown; fileName?: string };

export class JsonDataProvider implements ReportDataProvider {
  readonly id = "json" as const;

  async loadReportData(request: ReportGenerationRequest) {
    const config = request.source.configuration as
      Partial<JsonConfiguration> | undefined;
    if (config?.payload == null) {
      throw new ReportImportError("Import failed.", [
        "Choose a JSON report file or provide a normalized payload.",
      ]);
    }
    let payload: unknown = config.payload;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        throw new ReportImportError("Import failed.", [
          "The selected file is not valid JSON.",
        ]);
      }
    }

    const partialSchema = industrialMarketReportSchema.partial({
      dataCompleteness: true,
    });
    const parsed = partialSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ReportImportError(
        "Import failed.",
        describeReportSchemaError(parsed.error, payload),
      );
    }

    const importedAt = new Date().toISOString();
    const sourceId = config.fileName ?? "normalized-report.json";
    const incomplete = parsed.data;
    const report = {
      ...incomplete,
      dataCompleteness:
        incomplete.dataCompleteness ?? inferCompleteness(incomplete, sourceId),
    };
    const validated = industrialMarketReportSchema.safeParse(report);
    if (!validated.success) {
      throw new ReportImportError(
        "Import failed.",
        describeReportSchemaError(validated.error, report),
      );
    }
    const traced = addImportedMetricProvenance(validated.data, {
      sourceId,
      sourceType: "json",
      importedAt,
      reference: (index, field) => `$.submarkets[${index}].${field}`,
    });
    return {
      report: traced,
      provider: this.id,
      sourceMetadata: { importedAt, sourceName: sourceId },
      completeness: traced.dataCompleteness,
    };
  }
}
