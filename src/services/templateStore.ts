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
  deleteDraft(record: TemplateVersionSummary): Promise<void>;
  rename(
    record: Pick<TemplateVersionSummary, "id" | "version">,
    label: string,
  ): Promise<StoredTemplateVersion>;
}

/**
 * Mirrors ReportSaveConflictError (reportInstanceStore.ts): a saveDraft
 * whose `expectedRevision` no longer matches means something else saved
 * over the base this edit started from. The caller must not retry blindly —
 * see templateRecovery.ts and App.tsx's saveMasterTemplate for how the
 * rejected edit is preserved instead of discarded.
 */
export class TemplateSaveConflictError extends Error {
  constructor(
    message: string,
    readonly baseRevision: number,
    readonly currentRevision: number,
  ) {
    super(message);
    this.name = "TemplateSaveConflictError";
  }
}

const json = async <T>(response: Response): Promise<T> => {
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
    baseRevision?: number;
    currentRevision?: number;
  };
  if (response.status === 409 && body.code === "TEMPLATE_VERSION_CONFLICT")
    throw new TemplateSaveConflictError(
      body.error ?? "The template changed on the server.",
      body.baseRevision ?? -1,
      body.currentRevision ?? -1,
    );
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
          body: JSON.stringify({ template, expectedRevision: record.revision }),
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
  async rename(record, label) {
    return json(
      await fetch(
        `/api/templates/${encodeURIComponent(record.id)}/versions/${encodeURIComponent(record.version)}/label`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ label }),
        },
      ),
    );
  },
  async deleteDraft(record) {
    const response = await fetch(
      `/api/templates/${encodeURIComponent(record.id)}/versions/${encodeURIComponent(record.version)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(
        body.error ?? `Template API returned ${response.status}.`,
      );
    }
  },
};
