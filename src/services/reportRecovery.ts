import type { ManualOverride } from "../report-engine/schema/generation";
import type { ReportPage } from "../types/report";

const PREFIX = "lee-report-studio.report-recovery.v1.";

export interface ReportRecoveryRecord {
  reportId: string;
  baseRevision: number;
  pages: ReportPage[];
  manualOverrides: ManualOverride[];
  savedAt: string;
}

const key = (reportId: string) => `${PREFIX}${reportId}`;

export const reportRecovery = {
  load(reportId: string): ReportRecoveryRecord | undefined {
    try {
      const value = localStorage.getItem(key(reportId));
      if (!value) return undefined;
      const parsed = JSON.parse(value) as Partial<ReportRecoveryRecord>;
      if (
        parsed.reportId !== reportId ||
        !Number.isInteger(parsed.baseRevision) ||
        !Array.isArray(parsed.pages) ||
        !Array.isArray(parsed.manualOverrides) ||
        typeof parsed.savedAt !== "string"
      )
        return undefined;
      return parsed as ReportRecoveryRecord;
    } catch (error) {
      console.warn("Report recovery data could not be read.", error);
      return undefined;
    }
  },
  save(record: ReportRecoveryRecord) {
    try {
      localStorage.setItem(key(record.reportId), JSON.stringify(record));
    } catch (error) {
      console.warn("Report recovery data could not be saved.", error);
    }
  },
  clear(reportId: string) {
    localStorage.removeItem(key(reportId));
  },
};
