import type { ReportTemplate } from "../types/report";
import type {
  StoredTemplateVersion,
  TemplateVersionSummary,
} from "../types/templateLibrary";

export interface TemplateStore {
  list(): Promise<TemplateVersionSummary[]>;
  versions(id: string): Promise<TemplateVersionSummary[]>;
  get(id: string, version: string): Promise<StoredTemplateVersion>;
  getPublished(id: string): Promise<StoredTemplateVersion | undefined>;
  saveDraft(
    record: StoredTemplateVersion,
    template: ReportTemplate,
  ): Promise<StoredTemplateVersion>;
  createVersion(
    record: StoredTemplateVersion,
    template?: ReportTemplate,
  ): Promise<StoredTemplateVersion>;
  publish(record: StoredTemplateVersion): Promise<StoredTemplateVersion>;
}

const json = async <T>(response: Response): Promise<T> => {
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(body.error ?? `Template API returned ${response.status}.`);
  return body;
};

export const templateStore: TemplateStore = {
  async list() {
    return (
      await json<{ templates: TemplateVersionSummary[] }>(
        await fetch("/api/templates"),
      )
    ).templates;
  },
  async versions(id) {
    return (
      await json<{ versions: TemplateVersionSummary[] }>(
        await fetch(`/api/templates/${encodeURIComponent(id)}/versions`),
      )
    ).versions;
  },
  async get(id, version) {
    return json(
      await fetch(
        `/api/templates/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}`,
      ),
    );
  },
  async getPublished(id) {
    const response = await fetch(
      `/api/templates/${encodeURIComponent(id)}/published`,
    );
    if (response.status === 404) return undefined;
    return json(response);
  },
  async saveDraft(record, template) {
    return json(
      await fetch(
        `/api/templates/${encodeURIComponent(record.id)}/versions/${encodeURIComponent(record.version)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ template }),
        },
      ),
    );
  },
  async createVersion(record, template) {
    return json(
      await fetch(
        `/api/templates/${encodeURIComponent(record.id)}/versions/${encodeURIComponent(record.version)}/new`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ template }),
        },
      ),
    );
  },
  async publish(record) {
    return json(
      await fetch(
        `/api/templates/${encodeURIComponent(record.id)}/versions/${encodeURIComponent(record.version)}/publish`,
        { method: "POST" },
      ),
    );
  },
};
