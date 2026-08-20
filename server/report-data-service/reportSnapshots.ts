import { createHash, randomUUID } from "node:crypto";
import type { IndustrialMarketReport } from "../../src/report-engine/schema/industrialMarketReport.ts";
import type { ReportSourceMetadata } from "./contracts.ts";

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`)
    .join(",")}}`;
};

export const hashNormalizedReport = (report: IndustrialMarketReport) =>
  createHash("sha256").update(canonicalize(report)).digest("hex");

export interface ReportSnapshot {
  id: string;
  generatedAt: string;
  reportDefinitionVersion: string;
  sourceMetadata: ReportSourceMetadata;
  hash: string;
  report: IndustrialMarketReport;
}

export interface ReportSnapshotStore {
  save(snapshot: ReportSnapshot): Promise<void>;
  get(id: string): Promise<ReportSnapshot | null>;
}

export class InMemoryReportSnapshotStore implements ReportSnapshotStore {
  private readonly snapshots = new Map<string, ReportSnapshot>();

  async save(snapshot: ReportSnapshot) {
    if (this.snapshots.has(snapshot.id))
      throw new Error(`Snapshot ${snapshot.id} already exists.`);
    this.snapshots.set(snapshot.id, structuredClone(snapshot));
  }

  async get(id: string) {
    const snapshot = this.snapshots.get(id);
    return snapshot ? structuredClone(snapshot) : null;
  }
}

export const prepareSnapshot = (
  report: IndustrialMarketReport,
  sourceMetadata: ReportSourceMetadata,
): ReportSnapshot => ({
  id: `snapshot-${randomUUID()}`,
  generatedAt: sourceMetadata.generatedAt,
  reportDefinitionVersion: sourceMetadata.reportDefinitionVersion,
  sourceMetadata: structuredClone(sourceMetadata),
  hash: hashNormalizedReport(report),
  report: structuredClone(report),
});
