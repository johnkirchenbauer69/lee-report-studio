import type { ReportTemplate } from "../../src/types/report.ts";
import type {
  StoredTemplateVersion,
  TemplateVersionSummary,
} from "../../src/types/templateLibrary.ts";

export interface TemplateRepository {
  initialize(seed?: ReportTemplate): Promise<void>;
  list(): Promise<TemplateVersionSummary[]>;
  listAll(): Promise<StoredTemplateVersion[]>;
  listVersions(id: string): Promise<TemplateVersionSummary[]>;
  get(id: string, version: string): Promise<StoredTemplateVersion | undefined>;
  getPublished(id: string): Promise<StoredTemplateVersion | undefined>;
  listFontAssetReferences(): Promise<Set<string>>;
  saveDraft(
    id: string,
    version: string,
    template: ReportTemplate,
    options?: { expectedRevision?: number },
  ): Promise<StoredTemplateVersion>;
  rename(id: string, version: string, label: string): Promise<StoredTemplateVersion>;
  createVersion(
    id: string,
    sourceVersion: string,
    template?: ReportTemplate,
  ): Promise<StoredTemplateVersion>;
  publish(id: string, version: string): Promise<StoredTemplateVersion>;
  deleteDraft(id: string, version: string): Promise<void>;
}
