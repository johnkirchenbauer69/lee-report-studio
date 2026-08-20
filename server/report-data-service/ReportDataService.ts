import { randomUUID } from "node:crypto";
import { inferCompleteness } from "../../src/data-providers/completeness.ts";
import { calculateMarketTotals } from "../../src/report-engine/calculations/marketCalculations.ts";
import {
  industrialMarketReportSchema,
  type MarketMetrics,
  type ProvenanceRecord,
} from "../../src/report-engine/schema/industrialMarketReport.ts";
import type { AscendixReportAdapter } from "../integrations/ascendix/AscendixReportAdapter.ts";
import {
  reportDataRequestSchema,
  type ReportDataRequest,
  type ReportDataResult,
} from "./contracts.ts";
import { INDUSTRIAL_MARKET_REPORT_DEFINITION_VERSION } from "./reportDefinitions.ts";
import {
  prepareSnapshot,
  type ReportSnapshotStore,
} from "./reportSnapshots.ts";

const metricKeys: (keyof MarketMetrics)[] = [
  "inventorySf",
  "deliveredSf",
  "underConstructionSf",
  "speculativeShare",
  "netAbsorptionSf",
  "vacancyRate",
  "availabilityRate",
  "askingNetRentPsf",
  "salesVolume",
];

const tolerance = (key: keyof MarketMetrics, value: number) =>
  ["vacancyRate", "availabilityRate", "speculativeShare"].includes(key)
    ? 0.0001
    : Math.max(1, Math.abs(value) * 0.000001);

export class ReportDataService {
  private lastSuccessfulRequestAt?: string;
  private readonly dependencies: {
    ascendixAdapter: AscendixReportAdapter;
    snapshotStore: ReportSnapshotStore;
    mode: "mock" | "salesforce";
    now?: () => Date;
    logger?: (entry: Record<string, unknown>) => void;
  };

  constructor(dependencies: {
    ascendixAdapter: AscendixReportAdapter;
    snapshotStore: ReportSnapshotStore;
    mode: "mock" | "salesforce";
    now?: () => Date;
    logger?: (entry: Record<string, unknown>) => void;
  }) {
    this.dependencies = dependencies;
  }

  async getIndustrialMarketReport(input: unknown): Promise<ReportDataResult> {
    const request = reportDataRequestSchema.parse(input);
    const requestId = randomUUID();
    const startedAt = Date.now();
    try {
      const source =
        await this.dependencies.ascendixAdapter.loadReportSource(request);
      const report = structuredClone(source.report);
      const calculationScope = request.calculationScope;
      const selectedSubmarkets =
        calculationScope.type === "all-submarkets"
          ? report.submarkets
          : report.submarkets.filter((item) =>
              calculationScope.submarkets.includes(item.name),
            );
      if (!selectedSubmarkets.length) {
        throw new Error(
          "The calculation scope did not match any Salesforce submarket records.",
        );
      }
      const authoritative = { ...report.overallMarket };
      const calculated = calculateMarketTotals(selectedSubmarkets);
      const hasHistoricalAggregate = report.provenance.some(
        (item) =>
          item.fieldPath.startsWith("overallMarket.") &&
          item.sources.some(
            (source) =>
              source.sourceType === "salesforce" ||
              this.dependencies.mode === "mock",
          ),
      );
      const useHistoricalAggregate =
        calculationScope.type === "all-submarkets" && hasHistoricalAggregate;
      if (!useHistoricalAggregate) {
        report.overallMarket = {
          ...report.overallMarket,
          ...calculated,
        };
      }

      for (const key of metricKeys) {
        const fieldPath = `overallMarket.${key}`;
        const index = report.provenance.findIndex(
          (item) => item.fieldPath === fieldPath,
        );
        const selectedValue = useHistoricalAggregate
          ? authoritative[key]
          : calculated[key];
        const difference = Math.abs(authoritative[key] - calculated[key]);
        const status = useHistoricalAggregate
          ? difference <= tolerance(key, authoritative[key])
            ? ("matched" as const)
            : ("conflict" as const)
          : ("calculated" as const);
        const calculationSource = {
          sourceId: "lee-report-cross-check",
          sourceType: "calculated" as const,
          value: calculated[key],
          reference: `Cross-check across ${selectedSubmarkets.length} submarkets`,
        };
        const crossCheck: ProvenanceRecord = {
          fieldPath,
          selectedValue,
          sources: [calculationSource],
          authority: useHistoricalAggregate
            ? "Historical Market_Data aggregate"
            : "LEE Report Studio calculation engine",
          status,
          critical: ["inventorySf", "vacancyRate", "availabilityRate"].includes(
            key,
          ),
          note:
            status === "calculated"
              ? "No matching full-market historical aggregate applies to this calculation scope."
              : status === "conflict"
                ? `Stored historical value differs from the deterministic submarket cross-check by ${difference}.`
                : "Stored historical value matches the deterministic submarket cross-check within tolerance.",
          calculation: {
            formula: `calculateMarketTotals(submarkets).${key}`,
            inputPaths: selectedSubmarkets.map(
              (item) => `submarkets.${item.name}.${key}`,
            ),
            inputCount: selectedSubmarkets.length,
          },
        };
        if (index >= 0) {
          report.provenance[index] = {
            ...report.provenance[index],
            selectedValue,
            sources: [
              ...report.provenance[index].sources.filter(
                (item) => item.sourceId !== calculationSource.sourceId,
              ),
              calculationSource,
            ],
            authority: crossCheck.authority,
            status,
            critical: crossCheck.critical,
            note: crossCheck.note,
            calculation: crossCheck.calculation,
          };
        } else report.provenance.push(crossCheck);
      }

      const sourceId =
        this.dependencies.mode === "salesforce"
          ? "salesforce-ascendix"
          : "explicit-mock-fixture";
      const inferred = inferCompleteness(report, sourceId).map((item) =>
        request.requestedSections &&
        !request.requestedSections.includes(item.section)
          ? { ...item, status: "not-requested" as const, sourceIds: [] }
          : item,
      );
      report.dataCompleteness = inferred;
      const validated = industrialMarketReportSchema.parse(report);
      const generatedAt = (
        this.dependencies.now?.() ?? new Date()
      ).toISOString();
      this.lastSuccessfulRequestAt = generatedAt;
      const sourceMetadata = {
        generatedAt,
        provider: "ascendix" as const,
        mode: this.dependencies.mode,
        reportDefinitionVersion: INDUSTRIAL_MARKET_REPORT_DEFINITION_VERSION,
        requestId,
        salesforceOrg: source.salesforceOrg,
        recordCounts: source.recordCounts,
      };
      const snapshot = prepareSnapshot(validated, sourceMetadata);
      await this.dependencies.snapshotStore.save(snapshot);
      this.dependencies.logger?.({
        event: "report_data_retrieved",
        requestId,
        market: request.market,
        period: request.period,
        provider: sourceMetadata.provider,
        mode: sourceMetadata.mode,
        durationMs: Date.now() - startedAt,
        recordCounts: source.recordCounts,
        result: "success",
        snapshotId: snapshot.id,
      });
      return {
        report: validated,
        sourceMetadata,
        completeness: inferred,
        snapshot: { id: snapshot.id, hash: snapshot.hash },
      };
    } catch (error) {
      this.dependencies.logger?.({
        event: "report_data_retrieved",
        requestId,
        market: (input as { market?: unknown })?.market,
        period: (input as { period?: unknown })?.period,
        provider: "ascendix",
        mode: this.dependencies.mode,
        durationMs: Date.now() - startedAt,
        result: "error",
        error:
          error instanceof Error ? error.message : "Unknown report data error",
      });
      throw error;
    }
  }

  getSnapshot(id: string) {
    return this.dependencies.snapshotStore.get(id);
  }

  async getStatus() {
    return {
      ...(await this.dependencies.ascendixAdapter.health()),
      lastSuccessfulRequestAt: this.lastSuccessfulRequestAt,
      reportDefinitionVersion: INDUSTRIAL_MARKET_REPORT_DEFINITION_VERSION,
    };
  }
}

export const toReportGenerationRequest = (request: ReportDataRequest) => ({
  templateId: "industrial-market-report",
  market: request.market,
  period: request.period,
  calculationScope: request.calculationScope,
  pageSelection: { submarkets: [] as string[] },
  source: { provider: "ascendix" as const },
});
