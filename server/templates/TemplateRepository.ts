import type { ReportTemplate } from "../../src/types/report.ts";
import type {
  StoredTemplateVersion,
  TemplateVersionSummary,
} from "../../src/types/templateLibrary.ts";

export interface TemplateRepository {
  initialize(seed?: ReportTemplate): Promise<void>;
  list(): Promise<TemplateVersionSummary[]>;
  listVersions(id: string): Promise<TemplateVersionSummary[]>;
  get(id: string, version: string): Promise<StoredTemplateVersion | undefined>;
  getPublished(id: string): Promise<StoredTemplateVersion | undefined>;
  saveDraft(
    id: string,
    version: string,
    template: ReportTemplate,
  ): Promise<StoredTemplateVersion>;
  createVersion(
    id: string,
    sourceVersion: string,
    template?: ReportTemplate,
  ): Promise<StoredTemplateVersion>;
  publish(id: string, version: string): Promise<StoredTemplateVersion>;
}
