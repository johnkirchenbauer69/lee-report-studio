import type { ReportTemplate } from "../types/report";

const PREFIX = "lee-report-studio.template-recovery.v1.";

export interface TemplateRecoveryRecord {
  id: string;
  version: string;
  baseRevision: number;
  template: ReportTemplate;
  savedAt: string;
}

const key = (id: string, version: string) => `${PREFIX}${id}@${version}`;

/**
 * Mirrors reportRecovery.ts for master templates. A save rejected by
 * TemplateSaveConflictError (see templateStore.ts) is never just dropped —
 * it's stashed here, keyed by the exact draft it was edited from, so the
 * editor can recover it (or the user can re-apply it via "Save as new
 * version") instead of it silently vanishing.
 */
export const templateRecovery = {
  load(id: string, version: string): TemplateRecoveryRecord | undefined {
    try {
      const value = localStorage.getItem(key(id, version));
      if (!value) return undefined;
      const parsed = JSON.parse(value) as Partial<TemplateRecoveryRecord>;
      if (
        parsed.id !== id ||
        parsed.version !== version ||
        !Number.isInteger(parsed.baseRevision) ||
        !parsed.template ||
        typeof parsed.savedAt !== "string"
      )
        return undefined;
      return parsed as TemplateRecoveryRecord;
    } catch (error) {
      console.warn("Template recovery data could not be read.", error);
      return undefined;
    }
  },
  save(record: TemplateRecoveryRecord) {
    try {
      localStorage.setItem(key(record.id, record.version), JSON.stringify(record));
    } catch (error) {
      console.warn("Template recovery data could not be saved.", error);
    }
  },
  clear(id: string, version: string) {
    localStorage.removeItem(key(id, version));
  },
};
