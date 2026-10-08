import type { ReportTemplate } from "../../types/report";

/** Explicit migration for a newly-created draft only; never mutates the source. */
export function withNativeClosingPages(source: ReportTemplate, reference: ReportTemplate): ReportTemplate {
  const ids = new Set(["data-methodology", "definitions", "contacts", "who-we-are"]);
  const replacements = new Map(reference.pages.filter(page => ids.has(page.id)).map(page => [page.id, page]));
  return { ...structuredClone(source), pages: source.pages.map(page => structuredClone(replacements.get(page.id) ?? page)) };
}
