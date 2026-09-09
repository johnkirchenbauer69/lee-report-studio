import type { ReportInstance } from "../../src/report-engine/schema/generation.ts";
import type { ReportPage } from "../../src/types/report.ts";
import type { StoredTemplateVersion } from "../../src/types/templateLibrary.ts";

export type AssetArtifactType =
  | "draft-template"
  | "published-template"
  | "archived-template"
  | "report-instance";

export interface AssetDependency {
  artifactType: AssetArtifactType;
  artifactId: string;
  version?: string;
}

export interface AssetDependencyResponse {
  draftTemplates: AssetDependency[];
  publishedTemplates: AssetDependency[];
  archivedTemplates: AssetDependency[];
  reportInstances: AssetDependency[];
}

interface TemplateReader {
  listAll(): Promise<StoredTemplateVersion[]>;
}

interface ReportReader {
  list(): Promise<ReportInstance[]>;
}

type IntegrityLog = (entry: Record<string, unknown>) => void;

const assetUrlPattern =
  /\/api\/assets\/([^/?#"'()\s]+)\/content(?=[?#"'()\s]|$)/g;

/**
 * Pages are the canonical document reference boundary. The recursive walk
 * covers current and future nested style/table/chart structures while only
 * accepting explicit asset keys or Studio asset-content URLs.
 */
export function collectPageAssetReferences(pages: ReportPage[]) {
  const references = new Set<string>();
  const visit = (value: unknown, key?: string) => {
    if (typeof value === "string") {
      if ((key === "assetId" || key === "fontAssetId") && value)
        references.add(value);
      for (const match of value.matchAll(assetUrlPattern))
        references.add(decodeURIComponent(match[1]!));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item));
      return;
    }
    if (!value || typeof value !== "object") return;
    Object.entries(value).forEach(([childKey, child]) =>
      visit(child, childKey),
    );
  };
  visit(pages);
  return references;
}

const emptyDependencies = (): AssetDependencyResponse => ({
  draftTemplates: [],
  publishedTemplates: [],
  archivedTemplates: [],
  reportInstances: [],
});

const templateBucket = (status: StoredTemplateVersion["status"]) =>
  status === "draft"
    ? ("draftTemplates" as const)
    : status === "published"
      ? ("publishedTemplates" as const)
      : ("archivedTemplates" as const);

/** Rebuilt on demand for deletion operations; current repositories are small. */
export class AssetReferenceIndex {
  constructor(
    private readonly templates: TemplateReader,
    private readonly reports: ReportReader,
    private readonly logger: IntegrityLog = () => undefined,
  ) {}

  async dependencies(assetId: string): Promise<AssetDependencyResponse> {
    try {
      const [templates, reports] = await Promise.all([
        this.templates.listAll(),
        this.reports.list(),
      ]);
      const result = emptyDependencies();
      for (const record of templates) {
        if (!collectPageAssetReferences(record.template.pages).has(assetId))
          continue;
        result[templateBucket(record.status)].push({
          artifactType: `${record.status}-template`,
          artifactId: record.id,
          version: record.version,
        });
      }
      for (const report of reports) {
        const pageReferences = collectPageAssetReferences(report.pages);
        const fontReferences = new Set(
          report.fontReferences.map((reference) => reference.assetId),
        );
        if (!pageReferences.has(assetId) && !fontReferences.has(assetId))
          continue;
        result.reportInstances.push({
          artifactType: "report-instance",
          artifactId: report.id,
          version: report.templateVersion,
        });
      }
      return result;
    } catch (error) {
      this.logger({
        event: "asset_dependency_scan_failure",
        operation: "asset_delete_scan",
        assetId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      throw error;
    }
  }
}

export const assetDependencyCount = (references: AssetDependencyResponse) =>
  Object.values(references).reduce((total, items) => total + items.length, 0);
