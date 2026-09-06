import type { ReportTemplate } from "../types/report";

export function openedTemplateEditorState(template: ReportTemplate) {
  return { pageId: template.pages[0].id, selectedIds: [] as string[] };
}

export function savedTemplateEditorState(
  template: ReportTemplate,
  currentPageId: string,
  selectedIds: readonly string[],
) {
  const page =
    template.pages.find((candidate) => candidate.id === currentPageId) ??
    template.pages[0];
  const available = new Set(page.elements.map((element) => element.id));
  return {
    pageId: page.id,
    selectedIds: selectedIds.filter((id) => available.has(id)),
  };
}
