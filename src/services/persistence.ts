import type { ReportTemplate } from '../types/report';

const STORAGE_KEY = 'lee-report-studio.document.v2';

export interface PersistenceService {
  load(): ReportTemplate | undefined;
  save(template: ReportTemplate): void;
  clear(): void;
}

export const localPersistence: PersistenceService = {
  load() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value ? JSON.parse(value) as ReportTemplate : undefined;
    } catch (error) {
      console.warn('LEE Report Studio could not restore the saved document.', error);
      return undefined;
    }
  },
  save(template) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(template)); }
    catch (error) { console.warn('LEE Report Studio could not save the document.', error); }
  },
  clear() { localStorage.removeItem(STORAGE_KEY); },
};
