import type { FontReference, ReportTemplate } from "./report";

export type TemplateStatus = "draft" | "published" | "archived";

export interface TemplateVersionSummary {
  id: string;
  name: string;
  templateType: "industrial-market-report";
  version: string;
  status: TemplateStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  parentVersion?: string;
  checksum: string;
  pageDefinitionCount: number;
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
