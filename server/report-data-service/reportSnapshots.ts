import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, link, unlink } from "node:fs/promises";
import path from "node:path";
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

/** Durable internal provenance, including source IDs excluded from browser presentation. */
export class FileSystemReportSnapshotStore implements ReportSnapshotStore {
  private readonly root: string;
  constructor(dataRoot: string) { this.root = path.join(dataRoot, "report-source-snapshots"); }
  private filename(id: string) {
    if (!/^snapshot-[a-z0-9-]+$/.test(id)) throw new Error("Invalid snapshot identifier");
    return path.join(this.root, `${id}.json`);
  }
  async save(snapshot: ReportSnapshot) {
    const destination = this.filename(snapshot.id);
    if (hashNormalizedReport(snapshot.report) !== snapshot.hash) throw new Error("Snapshot hash mismatch");
    await mkdir(this.root, { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(snapshot), { flag: "wx" });
    try {
      // Atomic create-only publication; never replace a previously frozen snapshot.
      await link(temporary, destination);
    } finally { await unlink(temporary); }
  }
  async get(id: string): Promise<ReportSnapshot | null> {
    const filename = this.filename(id);
    try {
      const snapshot = JSON.parse(await readFile(filename, "utf8")) as ReportSnapshot;
      if (snapshot.id !== id || hashNormalizedReport(snapshot.report) !== snapshot.hash) throw new Error("Stored snapshot failed integrity validation");
      return snapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}

export const prepareSnapshot = (
  report: IndustrialMarketReport,
  sourceMetadata: ReportSourceMetadata,
): ReportSnapshot => {
  // Hash the exact JSON representation that will survive a process restart.
  const persisted = JSON.parse(JSON.stringify(report)) as IndustrialMarketReport;
  return {
  id: `snapshot-${randomUUID()}`,
  generatedAt: sourceMetadata.generatedAt,
  reportDefinitionVersion: sourceMetadata.reportDefinitionVersion,
  sourceMetadata: structuredClone(sourceMetadata),
  hash: hashNormalizedReport(persisted),
  report: persisted,
  };
};
