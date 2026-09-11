import type { FontReference, ReportTemplate } from "./report";

export type TemplateStatus = "draft" | "published" | "archived";

export interface TemplateVersionSummary {
  id: string;
  name: string;
  /**
   * User-assigned display label for this specific version (e.g. "Q3 2026
   * working draft"), distinct from `name` — which mirrors the document's
   * own `template.name` and flows into exported PDF title metadata. Library
   * UI should prefer `label` when set and fall back to `name` + `version`.
   * Renaming never touches `template`, `checksum`, or `revision`.
   */
  label?: string;
  templateType: "industrial-market-report";
  version: string;
  status: TemplateStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  parentVersion?: string;
  checksum: string;
  pageDefinitionCount: number;
  /**
   * Monotonic per-version counter used for optimistic-concurrency saves
   * (see FileSystemTemplateRepository.saveDraft's `expectedRevision`).
   * Incremented only by saveDraft; unaffected by rename.
   */
  revision: number;
}

export interface StoredTemplateVersion extends TemplateVersionSummary {
  template: ReportTemplate;
  assetReferences: string[];
  managedFontReferences: FontReference[];
}

export interface CreateTemplateVersionInput {
  sourceVersion: string;
  template?: ReportTemplate;
}
