import {
  describeReportSchemaError,
  industrialMarketReportSchema,
} from "../../report-engine/schema/industrialMarketReport";
import type { ReportGenerationRequest } from "../../report-engine/schema/generation";
import type { ReportDataProvider } from "../ReportDataProvider";
import { ReportImportError } from "../ReportDataProvider";

export class AscendixDataProvider implements ReportDataProvider {
  readonly id = "ascendix" as const;

  constructor(
    private readonly endpoint = "/api/report-data/industrial-market",
  ) {}

  async loadReportData(request: ReportGenerationRequest) {
    const endpoint = this.endpoint.startsWith("/")
      ? new URL(
          this.endpoint,
          globalThis.location?.origin ?? "http://127.0.0.1:8787",
        ).toString()
      : this.endpoint;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reportType: "industrial-market-report",
        market: request.market,
        period: request.period,
        calculationScope: request.calculationScope,
        timeContext: { type: "historical-period", period: request.period },
      }),
    });
    if (!response.ok) {
      throw new ReportImportError("Ascendix import is unavailable.", [
        "Configure the authenticated server-side Ascendix/Salesforce adapter. No credentials are accepted in the browser.",
      ]);
    }
    const payload: unknown = await response.json();
    const parsed = industrialMarketReportSchema.safeParse(
      (payload as { report?: unknown })?.report,
    );
    if (!parsed.success) {
      throw new ReportImportError(
        "Ascendix returned an invalid report payload.",
        describeReportSchemaError(parsed.error, payload),
      );
    }

    const envelope = payload as {
      sourceMetadata?: {
        generatedAt?: string;
        reportDefinitionVersion?: string;
      };
      completeness?: typeof parsed.data.dataCompleteness;
      snapshot?: { id?: string; hash?: string };
    };
    const importedAt = envelope.sourceMetadata?.generatedAt;
    const definition = envelope.sourceMetadata?.reportDefinitionVersion;
    if (
      !importedAt ||
      !definition ||
      !envelope.snapshot?.id ||
      !envelope.snapshot.hash
    ) {
      throw new ReportImportError(
        "Ascendix returned an incomplete service envelope.",
      );
    }
    return {
      report: parsed.data,
      provider: this.id,
      sourceMetadata: {
        importedAt,
        sourceName: "ascendix-report-data-service",
        sourceVersion: definition,
      },
      completeness: envelope.completeness ?? parsed.data.dataCompleteness,
      snapshot: {
        id: envelope.snapshot.id,
        hash: envelope.snapshot.hash,
        generatedAt: importedAt,
        reportDefinitionVersion: definition,
      },
    };
  }
}
